# Smart Classification: Speed Fix + Multi-Dimensional Output + Guardrails + Explanations

Read SPEC.md for full project context.

## Problems to Fix
1. LLM classification is too slow — 42 seconds for 82 threads is unacceptable. Target: under 10 seconds.
2. LLM returns a flat bucket name — it should return structured dimensions that map to buckets more intelligently.
3. No protection against auto-archiving critical emails (fraud alerts, payment failures, security notices).
4. Classification reasons exist but aren't prominently shown to the user.

---

## Part 1: Fix LLM Speed

### 1a: Verify parallel batching is working
Check src/app/api/classify/route.ts. The batches MUST run in parallel, not sequentially.

Correct pattern:
```typescript
const CONCURRENCY = 4;
for (let i = 0; i < batches.length; i += CONCURRENCY) {
  const group = batches.slice(i, i + CONCURRENCY);
  const results = await Promise.all(group.map(b => classifyBatch(b)));
  // 500ms pause only between GROUPS, not between every batch
  if (i + CONCURRENCY < batches.length) await new Promise(r => setTimeout(r, 500));
}
```

If the code is doing `for...of` with `await` on each batch, that's sequential. Fix it.

### 1b: Trim the LLM input payload
The biggest speed killer is sending too much text. For each thread in the batch, send ONLY:
```typescript
{
  id: thread.id,
  subject: thread.subject.slice(0, 100),        // max 100 chars
  sender: thread.sender.slice(0, 50),            // max 50 chars
  senderEmail: thread.senderEmail,
  snippet: thread.snippet.slice(0, 150),         // max 150 chars — this is the big one
}
```

Do NOT send full snippets. The LLM doesn't need 500 chars of email body to classify. 150 chars is plenty.

### 1c: Trim bucket definitions in the prompt
Don't send full bucket descriptions and examples to the LLM if they're long. Trim:
```typescript
buckets.map(b => ({
  name: b.name,
  description: (b.description || "").slice(0, 100),
}))
```

### 1d: Batch DB writes in a transaction
After classification, update all threads in one transaction:
```typescript
await prisma.$transaction(
  results.map(r => prisma.thread.update({
    where: { id: r.threadId },
    data: { bucketId: r.bucketId, confidence: r.confidence, reason: r.reason }
  }))
);
```

NOT one-by-one in a loop.

### 1e: Use a tighter system prompt
The system prompt should be short and directive. Every extra token in the system prompt adds latency across all batches.

### Speed target
- 82 threads at batch size 40 = 2 batches
- Run in parallel = 1 round of API calls
- Each call: ~3-4 seconds with gpt-5-mini
- DB write: <1 second in a transaction
- **Total: under 8 seconds**

---

## Part 2: Multi-Dimensional LLM Output

Instead of asking the LLM "assign to a bucket", ask it to evaluate structured dimensions. Then MAP dimensions to buckets deterministically.

### New LLM prompt

Replace the existing classification prompt with this:

**System prompt:**
```
You are an email classifier. For each email, output a JSON assessment with these dimensions. Be concise. JSON only, no markdown.
```

**User prompt:**
```
Classify each email thread on these dimensions:

1. category: personal | work | finance | commerce | travel | newsletter | social | system | recruiting
2. actionability: none | low | high
   - "high" = someone is asking the user to do something, confirm, reply, approve, pay, sign, review
   - "low" = informational but might need attention later
   - "none" = no action needed
3. urgency: low | medium | high
   - "high" = time-sensitive, deadline soon, failure, security alert
   - "medium" = should handle this week
   - "low" = no time pressure
4. risk: low | medium | high
   - "high" = security alert, fraud, payment failure, legal, account compromise
   - "medium" = billing, subscription changes, delivery issues
   - "low" = everything else
5. sender_type: person | service | bulk | unknown
   - "person" = a real human writing to the user
   - "service" = automated from a known service (github, stripe, zoom, etc.)
   - "bulk" = newsletter, marketing, mass email
   - "unknown" = can't tell

Threads:
{threads JSON}

Respond with JSON array only:
[
  {
    "threadId": "...",
    "category": "...",
    "actionability": "...",
    "urgency": "...",
    "risk": "...",
    "sender_type": "...",
    "reason": "brief 10-word-max explanation"
  }
]
```

### Map dimensions to buckets

After the LLM returns structured output, map to buckets deterministically:

```typescript
function mapDimensionsToBucket(
  d: DimensionalResult,
  buckets: Bucket[]
): { bucketName: string; confidence: number; explanation: string } {

  // GUARDRAIL: High risk ALWAYS goes to Action Required, never auto-archived
  if (d.risk === "high") {
    return {
      bucketName: "Action Required",
      confidence: 0.95,
      explanation: `⚠️ High risk: ${d.reason}`,
    };
  }

  // High actionability → Action Required
  if (d.actionability === "high") {
    return {
      bucketName: "Action Required",
      confidence: 0.9,
      explanation: `Action needed: ${d.reason}`,
    };
  }

  // Newsletters and bulk
  if (d.sender_type === "bulk" || d.category === "newsletter") {
    return {
      bucketName: "Newsletters",
      confidence: 0.9,
      explanation: `Bulk/newsletter: ${d.reason}`,
    };
  }

  // Finance
  if (d.category === "finance" || d.category === "commerce") {
    if (d.risk === "medium" || d.actionability === "low") {
      return {
        bucketName: "Finance / Receipts",
        confidence: 0.85,
        explanation: `Financial: ${d.reason}`,
      };
    }
  }

  // Recruiting
  if (d.category === "recruiting") {
    return {
      bucketName: "Recruiting / Job",
      confidence: 0.85,
      explanation: `Recruiting: ${d.reason}`,
    };
  }

  // Personal from real people with some urgency → Important
  if (d.sender_type === "person" && (d.urgency === "high" || d.urgency === "medium")) {
    return {
      bucketName: "Important",
      confidence: 0.85,
      explanation: `Personal, ${d.urgency} urgency: ${d.reason}`,
    };
  }

  // Personal from real people, low urgency → Personal
  if (d.sender_type === "person") {
    return {
      bucketName: "Personal",
      confidence: 0.8,
      explanation: `Personal: ${d.reason}`,
    };
  }

  // Service notifications, low urgency, no action → Can Wait or Auto-Archive
  if (d.sender_type === "service" && d.actionability === "none" && d.urgency === "low") {
    return {
      bucketName: "Auto-Archive",
      confidence: 0.8,
      explanation: `Low-priority notification: ${d.reason}`,
    };
  }

  // Service with some relevance → Can Wait
  if (d.sender_type === "service") {
    return {
      bucketName: "Can Wait",
      confidence: 0.75,
      explanation: `Service notification: ${d.reason}`,
    };
  }

  // Custom bucket matching: check if any user-created bucket matches the category/reason
  for (const bucket of buckets) {
    if (!bucket.isDefault && bucket.description) {
      const desc = bucket.description.toLowerCase();
      const reason = d.reason.toLowerCase();
      const cat = d.category.toLowerCase();
      if (desc.includes(cat) || reason.split(" ").some(w => desc.includes(w))) {
        return {
          bucketName: bucket.name,
          confidence: 0.7,
          explanation: `Matched custom bucket: ${d.reason}`,
        };
      }
    }
  }

  // Default fallback
  if (d.urgency === "medium" || d.actionability === "low") {
    return {
      bucketName: "Can Wait",
      confidence: 0.6,
      explanation: d.reason,
    };
  }

  return {
    bucketName: "Can Wait",
    confidence: 0.5,
    explanation: d.reason,
  };
}
```

### Store the dimensional data
Add fields to the Thread model to store the raw dimensions:

```prisma
model Thread {
  // ... existing fields
  aiCategory      String?   // "personal", "work", "finance", etc.
  aiActionability  String?   // "none", "low", "high"
  aiUrgency       String?   // "low", "medium", "high"
  aiRisk          String?   // "low", "medium", "high"
  aiSenderType    String?   // "person", "service", "bulk", "unknown"
}
```

Run `npx prisma db push`.

This lets you use the dimensions later for smarter features (filtering by urgency, sorting by risk, etc.) without re-classifying.

---

## Part 3: Security & Financial Guardrails

### Never auto-archive high-risk email
Add a post-classification guardrail that runs AFTER both rules and LLM:

```typescript
function applyGuardrails(thread: ClassifiedThread): ClassifiedThread {
  const protectedPatterns = {
    subjects: [
      /security alert/i, /fraud/i, /unauthorized/i, /suspicious/i,
      /payment fail/i, /card decline/i, /account (compromis|lock|suspend|restrict)/i,
      /password (reset|change|expire)/i, /verify your (identity|account|email)/i,
      /unusual (sign.in|activity|login)/i, /new (sign.in|device|login)/i,
      /tax (document|return|notice)/i, /legal notice/i, /court/i, /subpoena/i,
      /wire transfer/i, /past due/i, /final notice/i, /collections/i,
      /data breach/i, /privacy incident/i,
      /flight (cancel|delay|change)/i, /booking (cancel|change)/i,
      /delivery fail/i, /package return/i,
    ],
    senderDomains: [
      // Banks and finance
      /bank|chase|wellsfargo|citi|amex|visa|mastercard|discover/i,
      /paypal|venmo|cashapp|zelle|wise|transferwise/i,
      /irs\.gov|treasury\.gov/i,
      // Security
      /security|auth0|okta|duo|lastpass|1password/i,
    ],
  };

  const isProtected =
    protectedPatterns.subjects.some(p => p.test(thread.subject)) ||
    protectedPatterns.senderDomains.some(p => p.test(thread.senderEmail));

  if (isProtected) {
    // If it was going to Auto-Archive or Newsletters, rescue it
    if (["Auto-Archive", "Newsletters", "Can Wait"].includes(thread.bucketName)) {
      return {
        ...thread,
        bucketName: "Important",
        confidence: 0.95,
        reason: `⚠️ Protected: ${thread.reason}. Moved from ${thread.bucketName} — contains security/financial signals.`,
        aiRisk: "high",
      };
    }
  }

  return thread;
}
```

Run this AFTER classification, BEFORE saving to DB. It's a safety net that catches anything the rules or LLM might have mis-bucketed.

### Show a shield icon on protected threads
In the thread list, if `aiRisk === "high"`, show a small shield icon (🛡️ or a Lucide shield icon) next to the bucket tag. This tells the user "we're protecting this one."

---

## Part 4: Classification Explanations in UI

### Thread row: show reason on hover
Each thread row already shows a bucket pill. Add a tooltip on hover that shows the classification reason:
- "Sender rule: moondev@zoom.us → Auto-Archive"
- "Newsletter detected: sender is bulk, substack.com domain"
- "Action needed: someone asked you to review a document"
- "⚠️ Protected: payment failure alert, rescued from Auto-Archive"

### Expanded thread view: show full classification card
When a thread is expanded, show a small card below the snippet:

```
Classification
├── Bucket: Action Required
├── Source: AI classification
├── Category: finance
├── Urgency: high
├── Actionability: high
├── Risk: medium
├── Sender type: service
└── Reason: Payment method expired, action required by Friday
```

Style it as a subtle, collapsible section. Use muted text, small font. Don't make it loud — it's for users who want to understand, not everyone.

### Color-code urgency
On the thread row, in addition to the bucket pill and confidence dot:
- If `aiUrgency === "high"` → small red dot or red left border
- If `aiUrgency === "medium"` → small yellow dot or yellow left border
- If `aiRisk === "high"` → shield icon

This gives visual scanning without reading any text.

---

## Part 5: Update the LLM Classification Function

Rewrite src/lib/classify-llm.ts to:

1. Accept trimmed thread data (subject max 100, snippet max 150)
2. Use the new multi-dimensional prompt
3. Parse dimensional output
4. Map to buckets using `mapDimensionsToBucket`
5. Run guardrails
6. Return both the bucket assignment AND the raw dimensions

```typescript
export interface DimensionalClassification {
  threadId: string;
  bucketName: string;
  confidence: number;
  reason: string;
  category: string;
  actionability: string;
  urgency: string;
  risk: string;
  senderType: string;
}

export async function classifyWithLLM(
  client: OpenAI,
  model: string,
  threads: ThreadSummary[],
  buckets: BucketDef[]
): Promise<DimensionalClassification[]> {
  // ... implementation using the new prompt and mapping
}
```

### Update the classify route
After getting results from classifyWithLLM, save the dimensional fields:
```typescript
await prisma.$transaction(
  results.map(r => prisma.thread.update({
    where: { id: r.threadId },
    data: {
      bucketId: bucketIdMap[r.bucketName],
      confidence: r.confidence,
      reason: r.reason,
      aiCategory: r.category,
      aiActionability: r.actionability,
      aiUrgency: r.urgency,
      aiRisk: r.risk,
      aiSenderType: r.senderType,
    },
  }))
);
```

### Update GET /api/threads
Include the dimensional fields in the response so the frontend can display them.

---

## Build Order

1. Add dimensional fields to Thread model (aiCategory, aiActionability, aiUrgency, aiRisk, aiSenderType), run db push
2. Rewrite the LLM prompt to use multi-dimensional output
3. Implement mapDimensionsToBucket function
4. Implement applyGuardrails function
5. Fix parallel batching (verify it's actually parallel, not sequential)
6. Trim input payloads (subject 100, snippet 150, bucket descriptions 100)
7. Batch DB writes in a transaction
8. Update classify route to save dimensional fields
9. Update GET /api/threads to return dimensional fields
10. Add tooltip on thread row bucket pill (shows reason)
11. Add classification card to expanded thread view
12. Add urgency color coding (red/yellow left border)
13. Add shield icon for high-risk threads
14. Test speed: 82 threads should classify in under 10 seconds
15. Test guardrails: send a fake "payment failed" thread, verify it lands in Important not Auto-Archive

---

## Verification

Speed:
- 82 LLM-classified threads complete in under 10 seconds (down from 42)
- Batches run in parallel (add a console.log with timestamp at batch start/end to verify)
- Trimmed payloads: check that thread snippets in the LLM prompt are ≤150 chars

Multi-dimensional output:
- LLM returns category, actionability, urgency, risk, senderType for each thread
- Dimensional data is saved to Thread table (check with Prisma Studio)
- Bucket assignment comes from mapDimensionsToBucket, not directly from LLM
- A high-actionability email → "Action Required"
- A bulk newsletter → "Newsletters"
- A personal email from a real person with medium urgency → "Important"

Guardrails:
- An email with subject containing "payment failed" → never lands in Auto-Archive
- An email with subject "security alert" → lands in Important even if LLM said it was low urgency
- An email from a bank domain → protected
- Protected threads show shield icon in UI

Explanations:
- Hovering over a bucket pill shows the reason tooltip
- Expanding a thread shows the full classification card with all dimensions
- Urgency color coding appears: red border for high, yellow for medium
- Shield icon appears on high-risk threads

Data integrity:
- Rule-classified threads still work (no dimensional data, that's fine)
- Manual overrides still respected
- Sender rules still fire before LLM
- Reclassify re-runs full pipeline correctly

- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>SMART_CLASSIFY_DONE</promise>
