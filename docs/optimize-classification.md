# Optimization: Fix Classification Speed + Restructure Rule Engine

Read SPEC.md for full project context.

## Problem
Classification is taking over a minute for ~200 threads. The rule engine isn't catching enough threads before the LLM, so nearly everything is hitting OpenAI. Reclassify is especially slow because it's sending threads to the LLM that rules should handle.

## Goals
- Classify 200 threads in under 15 seconds
- Rules should handle 60-80% of threads (free, instant)
- LLM only handles genuinely ambiguous threads
- Reclassify respects the full rule hierarchy, not just LLM

---

## Part 1: Restructure the Rule Engine

The current rule engine is too narrow. Rewrite src/lib/classify-rules.ts with a comprehensive, layered approach.

### Rule Priority (checked in this exact order — first match wins)

#### Layer 0: Manual Overrides
- If `thread.manualOverride === true` → SKIP (never reclassify)

#### Layer 1: Sender Rules (learned from user corrections)
- Query SenderRule table for exact senderEmail match
- Query SenderRule table for senderDomain match (e.g., all of zoom.us)
- If match → assign bucket, reason = "Sender rule", confidence = 0.95
- Increment matchCount on the rule

#### Layer 2: Automated / Machine Email Detection → "Newsletters" or "Auto-Archive"
Detect emails that are clearly automated, not personal:

**By sender address patterns:**
- `noreply@`, `no-reply@`, `no_reply@`
- `notifications@`, `notification@`
- `updates@`, `update@`
- `news@`, `newsletter@`, `digest@`
- `marketing@`, `promotions@`, `promo@`
- `support@` (with certain subjects)
- `mailer-daemon@`
- `donotreply@`, `do-not-reply@`
- `info@` (when combined with bulk sender domains)
- `hello@` from known marketing domains
- `team@` from known SaaS products

**By sender domain (known bulk senders):**
```
substack.com, mailchimp.com, convertkit.com, beehiiv.com,
buttondown.email, revue.email, sendinblue.com, mailerlite.com,
campaignmonitor.com, constantcontact.com, sendgrid.net,
amazonses.com, mailgun.org, postmarkapp.com, mandrillapp.com,
hubspot.com, intercom.io, customer.io, drip.com, klaviyo.com,
activecampaign.com, getresponse.com, moosend.com
```

**By sender domain (known notification senders):**
```
zoom.us, calendly.com, notion.so, slack.com, discord.com,
github.com, gitlab.com, bitbucket.org, jira.atlassian.net,
trello.com, asana.com, monday.com, linear.app,
figma.com, canva.com, dropbox.com, google.com (notifications),
facebookmail.com, twitter.com, x.com, linkedin.com,
instagram.com, pinterest.com, tiktok.com, youtube.com,
medium.com, reddit.com, quora.com,
stripe.com, paypal.com, venmo.com, cashapp.com,
uber.com, lyft.com, doordash.com, grubhub.com,
amazon.com, ebay.com, walmart.com, target.com,
netflix.com, spotify.com, apple.com (itunes, receipts),
steamcommunity.com, ea.com, epicgames.com
```

→ If sender domain is in the bulk/newsletter list → "Newsletters"
→ If sender domain is in the notification list → classify based on subject:
  - Contains "receipt", "invoice", "payment", "order" → "Finance / Receipts"
  - Contains "calendar", "invite", "meeting", "event", "rsvp" → "Can Wait" (or a "Meetings" bucket if exists)
  - Everything else from notification domains → "Auto-Archive"

**By Gmail label:**
- `CATEGORY_PROMOTIONS` → "Newsletters"
- `CATEGORY_SOCIAL` → "Auto-Archive"
- `CATEGORY_UPDATES` → "Can Wait"
- `CATEGORY_FORUMS` → "Auto-Archive"

#### Layer 3: Keyword Rules on Subject

**Finance / Receipts** (case-insensitive):
```
receipt, invoice, payment, order confirmation, order shipped,
transaction, statement, billing, subscription renewed,
subscription confirmation, your order, purchase confirmation,
refund, charge, credit card, bank alert, wire transfer,
tax document, w-2, 1099, account statement
```

**Recruiting / Job** (case-insensitive):
```
job, opportunity, recruiter, hiring, role, position, career,
interview, application, we're hiring, job alert, your application,
offer letter, background check, onboarding, talent
```

**Action Required** (case-insensitive):
```
action required, urgent, asap, deadline, overdue, reminder,
follow up, response needed, please respond, time sensitive,
expiring, expires soon, last chance, final notice, past due,
confirmation needed, verify your, confirm your, reset your password,
security alert, unusual sign-in, suspicious activity
```

**Personal** (positive signals — only if NOT caught by above rules):
- Sender is a person (no `noreply`, no bulk domain, no company domain patterns)
- Subject doesn't match any keyword lists
- Short subject line (< 10 words, no marketing patterns)
- This is a WEAK signal — if nothing else matches, let LLM decide

#### Layer 4: Custom Bucket Matching
For each user-created custom bucket that has `examples` or `description`:
- Do a simple keyword match on the bucket's examples against thread subject + sender
- e.g., if bucket "Trading Research" has examples "bloomberg, market data, alpha", check if subject or sender contains those words
- This is a cheap pre-LLM filter for custom buckets

#### Layer 5: LLM Classification (everything remaining)
Only threads that survived all 4 layers above go to the LLM.

### Implementation: src/lib/classify-rules.ts

```typescript
interface RuleResult {
  bucketName: string;
  reason: string;
  confidence: number;
  source: "manual-override" | "sender-rule" | "auto-detect" | "keyword" | "custom-match";
}

// Main function — runs ALL rules in order
export function applyRules(
  thread: Thread,
  buckets: Bucket[],
  senderRules: SenderRule[]
): RuleResult | null {
  // Layer 1: Sender rules
  const senderResult = matchSenderRule(thread, senderRules, buckets);
  if (senderResult) return senderResult;

  // Layer 2: Automated email detection
  const autoResult = matchAutomatedEmail(thread, buckets);
  if (autoResult) return autoResult;

  // Layer 3: Keyword rules
  const keywordResult = matchKeywordRules(thread, buckets);
  if (keywordResult) return keywordResult;

  // Layer 4: Custom bucket matching
  const customResult = matchCustomBuckets(thread, buckets);
  if (customResult) return customResult;

  // No rule matched — needs LLM
  return null;
}
```

Make each layer its own function for readability and testability.

---

## Part 2: Speed Optimizations

### 2a: Parallel LLM batches
Currently batches run sequentially with delays. Change to parallel with a concurrency limit:

```typescript
// Instead of:
for (const batch of batches) {
  await classifyBatch(batch);
  await sleep(1500);
}

// Do:
const CONCURRENCY = 4;
const results = [];
for (let i = 0; i < batches.length; i += CONCURRENCY) {
  const concurrent = batches.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(
    concurrent.map(batch => classifyBatch(batch))
  );
  results.push(...batchResults.flat());
  // Small delay only between concurrent groups, not between every batch
  if (i + CONCURRENCY < batches.length) {
    await sleep(500);
  }
}
```

This means 4 batches fire simultaneously, then a 500ms pause, then the next 4. For 5 batches total (after rules handle most threads), this finishes in ~3-4 seconds instead of 30+.

### 2b: Batch size = 40 threads
Keep the current batch size of 40. With the rules catching most threads, you'll likely have 30-80 threads going to LLM, which is 1-2 batches.

### 2c: Remove excessive delays
- Remove the 1.5 second delay between batches
- Use 500ms delay only between concurrency groups (as above)
- OpenAI's gpt-5-mini can handle 4 concurrent requests easily

### 2d: Preload sender rules
Load sender rules ONCE at the start of classification, not per-thread:

```typescript
// At the start of the classify route:
const senderRules = await prisma.senderRule.findMany({
  where: { userId },
  include: { bucket: true },
});

// Pass to applyRules for each thread — no extra DB queries per thread
```

### 2e: Batch database updates
Instead of updating threads one-by-one after classification:

```typescript
// Instead of:
for (const result of results) {
  await prisma.thread.update({ where: { id: result.threadId }, data: { ... } });
}

// Do:
await prisma.$transaction(
  results.map(result =>
    prisma.thread.update({
      where: { id: result.threadId },
      data: {
        bucketId: result.bucketId,
        confidence: result.confidence,
        reason: result.reason,
        manualOverride: false,
      },
    })
  )
);
```

One transaction instead of N individual writes.

### 2f: Streaming progress
Send progress updates to the frontend so the user doesn't stare at a spinner:

Update the classify endpoint to return progress info, OR use Server-Sent Events:

For MVP, just make the frontend poll or use a simple approach:
- Return immediately with `{ started: true, totalThreads: N }`
- Frontend polls a status endpoint
- OR: just return the final result but make it fast enough that no progress is needed

Given the speed improvements, the whole thing should finish in 5-10 seconds, so a simple spinner is fine.

---

## Part 3: Smarter Reclassify

### Reclassify should NOT send everything to LLM

Current behavior (broken): reclassify=true → sends ALL threads to LLM
Correct behavior: reclassify=true → re-runs the FULL pipeline (rules first, then LLM for remainder)

```typescript
if (reclassifyAll) {
  // Reset all non-manual-override threads
  await prisma.thread.updateMany({
    where: { userId, manualOverride: false },
    data: { bucketId: null, confidence: null, reason: null },
  });
}

// Then run the normal pipeline:
// 1. Load threads (unclassified ones, i.e., bucketId is null)
// 2. Skip manualOverride threads
// 3. Run rules (sender rules, auto-detect, keywords, custom match)
// 4. Only remaining unmatched threads go to LLM
```

This means reclassify after adding a new bucket still works — rules re-run, custom bucket matching catches new matches, and only genuinely ambiguous threads hit the LLM.

---

## Part 4: Classification Stats

Update the classify response to show the user what happened:

```typescript
{
  total: 200,
  skippedManualOverrides: 5,
  classifiedBySenderRules: 45,
  classifiedByAutoDetect: 62,
  classifiedByKeywords: 28,
  classifiedByCustomMatch: 8,
  classifiedByLLM: 47,
  failed: 5,
  timeMs: 4200,
}
```

Show this in the toast after classification:
"Classified 200 threads in 4.2s (152 by rules, 47 by AI, 5 skipped)"

This gives the user confidence the rules are working and the system is getting smarter.

---

## Build Order

1. Rewrite src/lib/classify-rules.ts with the full layered rule engine
2. Update the classify route to use the new rules, pass sender rules, respect layers
3. Fix reclassify to re-run rules first, LLM only for remainder
4. Implement parallel batching (concurrency = 4, 500ms between groups)
5. Batch database updates in a transaction
6. Preload sender rules at classification start
7. Update the classify response to include detailed stats
8. Update the toast to show stats
9. Test with 200 threads — measure time
10. Tune: adjust concurrency, batch size if needed

---

## Verification

Speed:
- Classify 200 threads completes in under 15 seconds
- Reclassify 200 threads completes in under 15 seconds
- First run (no sender rules): rules catch 50%+, LLM handles the rest
- Subsequent runs (with sender rules): rules catch 70%+

Rule accuracy:
- Emails from noreply@ addresses → caught by auto-detect, not sent to LLM
- Emails from substack.com, mailchimp.com → "Newsletters" by auto-detect
- Emails from zoom.us → "Auto-Archive" or appropriate bucket by auto-detect
- Receipts from amazon, stripe, paypal → "Finance / Receipts" by keyword or auto-detect
- LinkedIn, GitHub notifications → "Auto-Archive" by auto-detect
- Actual personal emails from real people → NOT caught by rules, sent to LLM (correct)
- Custom bucket with examples catches relevant threads

Reclassify:
- Manual overrides are never touched
- Sender rules fire before LLM
- Adding a new custom bucket and reclassifying catches relevant threads
- Stats show breakdown: rules vs LLM vs skipped

Pipeline:
- No thread is classified by both rules and LLM (rules short-circuit)
- Sender rules increment matchCount
- Failed LLM batches don't crash the whole run

Database:
- Thread updates are batched in a transaction
- No N+1 query patterns

- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>SPEED_DONE</promise>
