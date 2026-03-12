# Refactor: Switch Classification from Anthropic to OpenAI

Read SPEC.md for full project context.

## Task
Replace the Anthropic API classification with OpenAI's API using GPT-5.2 (or GPT-5.4 as a configurable option). Remove the @anthropic-ai/sdk dependency entirely.

## Steps

### 1. Install OpenAI SDK, remove Anthropic SDK
```bash
npm install openai
npm uninstall @anthropic-ai/sdk @anthropic-ai/claude-code
```

### 2. Update .env.local
Add this variable (do NOT remove existing Google/NextAuth vars):
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2          # can also be gpt-5.4 or gpt-5-mini
```

Update .env.example to match.

### 3. Rewrite src/lib/classify-llm.ts
Replace the entire file. Use the OpenAI SDK's chat completions endpoint:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ThreadSummary {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
}

interface BucketDef {
  name: string;
  description: string | null;
  examples: string | null;
}

interface Classification {
  threadId: string;
  bucket: string;
  confidence: number;
  reason: string;
}

export async function classifyWithLLM(
  threads: ThreadSummary[],
  buckets: BucketDef[]
): Promise<Classification[]> {
  const model = process.env.OPENAI_MODEL || "gpt-5.2";

  const systemPrompt = `You are an email classification assistant. You will be given a list of email threads and a list of bucket definitions. Assign each thread to exactly one bucket. Respond with valid JSON only. No markdown, no backticks, no explanation.`;

  const userPrompt = `Classify each email thread into exactly one bucket.

Buckets:
${JSON.stringify(buckets, null, 2)}

Threads:
${JSON.stringify(threads, null, 2)}

Respond with JSON array only:
[
  { "threadId": "...", "bucket": "exact bucket name", "confidence": 0.0-1.0, "reason": "brief reason" }
]`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "[]";
    const cleaned = content.replace(/```json\n?|```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Handle both { results: [...] } and [...] formats
    const results = Array.isArray(parsed) ? parsed : parsed.results || parsed.classifications || [];

    return results.map((r: any) => ({
      threadId: r.threadId,
      bucket: r.bucket,
      confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
      reason: r.reason || "Classified by AI",
    }));
  } catch (error) {
    console.error("OpenAI classification error:", error);
    // Return all threads as unclassified
    return threads.map((t) => ({
      threadId: t.id,
      bucket: "Can Wait",
      confidence: 0,
      reason: "Classification failed",
    }));
  }
}
```

### 4. Delete the Anthropic fallback file
Remove src/lib/classify-llm-api.ts if it exists (that was the Anthropic fallback).

### 5. Update the classify API route (src/app/api/classify/route.ts)
- Remove any imports from @anthropic-ai/sdk or @anthropic-ai/claude-code
- Import classifyWithLLM from the rewritten src/lib/classify-llm.ts
- Keep the rule-based classification step unchanged
- Keep the batching logic (groups of 12, 1.5s delay between batches)
- Keep the response format: { classified, rulesBased, llmBased, failed }
- If OPENAI_API_KEY is not set, skip LLM classification and only use rules. Log a warning.

### 6. Clean up
- Remove any remaining references to Anthropic, claude-code, or @anthropic-ai anywhere in the codebase
- Make sure package.json has no Anthropic dependencies
- Run `npm install` to clean up node_modules

## Verification
- npm run dev starts without errors
- No references to Anthropic in any source file (grep -r "anthropic" src/)
- OPENAI_API_KEY is read from env
- Sign in → Sync → Classify works end to end
- Threads get assigned to correct buckets
- Changing OPENAI_MODEL to gpt-5.4 works without code changes
- If OPENAI_API_KEY is missing, rules-only classification still works
- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>REFACTOR_DONE</promise>
