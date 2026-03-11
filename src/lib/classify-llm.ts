import OpenAI from "openai";

export interface ThreadSummary {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  hasUnsubscribe?: boolean;
}

export interface BucketDef {
  name: string;
  description: string | null;
  examples: string | null;
  isDefault?: boolean;
}

export interface DimensionalClassification {
  threadId: string;
  bucket: string;
  confidence: number;
  reason: string;
  category: string;
  actionability: string;
  urgency: string;
  risk: string;
  senderType: string;
}

// Legacy compat
export type Classification = DimensionalClassification;

// ── Main classification function ──

interface LLMClassificationResult {
  threadId: string;
  bucket: string;
  confidence: number;
  reason: string;
}

export async function classifyWithLLM(
  client: OpenAI,
  model: string,
  threads: ThreadSummary[],
  buckets: BucketDef[],
  ruleHints?: Map<string, string>,
): Promise<DimensionalClassification[]> {
  const trimmedThreads = threads.map((t) => {
    const entry: Record<string, string | boolean> = {
      id: t.id,
      subject: t.subject.slice(0, 120),
      from: `${t.sender} <${t.senderEmail}>`,
      preview: t.snippet.slice(0, 200),
    };
    if (t.hasUnsubscribe) {
      entry.hasUnsubscribe = true;
    }
    // Include rule suggestion as a hint for AI to confirm or override
    const hint = ruleHints?.get(t.id);
    if (hint) {
      entry.suggested = hint;
    }
    return entry;
  });

  const bucketList = buckets.map((b) => {
    let desc = `- "${b.name}"`;
    if (b.description) desc += `: ${b.description}`;
    if (b.examples) desc += ` (e.g. ${b.examples})`;
    return desc;
  }).join("\n");

  const prompt = `You are an email classifier. The user has defined these buckets to organize their inbox. Each bucket's name, description, and examples define EXACTLY what belongs in it.

BUCKETS (these are the ONLY valid categories):
${bucketList}

INSTRUCTIONS:
- Read each email's subject, sender, and preview carefully
- Match each email to the bucket whose description and examples best fit the email's content
- The bucket descriptions are the rules — if a bucket says "school related emails" then school emails go there
- Some emails have a "suggested" field — this is a quick rule-based guess. Confirm it if correct, or override it with the right bucket
- Emails with "hasUnsubscribe": true have an unsubscribe header — this is a strong signal for newsletters, marketing, or auto-archive buckets
- Use the bucket name EXACTLY as written (case-sensitive)
- If an email doesn't clearly fit any specific bucket, put it in the most general/catch-all bucket
- Do NOT force emails into wrong buckets — accuracy matters more than specificity
- confidence: 0.0-1.0 (how well the email matches the bucket's description)
- reason: brief explanation (10 words max)

Emails to classify:
${JSON.stringify(trimmedThreads)}

Respond with a JSON array ONLY. No markdown, no backticks:
[{"threadId":"...","bucket":"exact bucket name","confidence":0.9,"reason":"..."}]`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "You classify emails into user-defined buckets. Always respond with valid JSON only. Never wrap in markdown code blocks.",
      },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0]?.message?.content || "";
  const parsed = parseResponse(text);

  // Validate bucket names (case-insensitive) and build results
  const bucketNames = new Set(buckets.map((b) => b.name));
  const bucketNamesLower = new Map(buckets.map((b) => [b.name.toLowerCase(), b.name]));

  return parsed
    .map((r) => {
      const exactName = bucketNames.has(r.bucket) ? r.bucket : bucketNamesLower.get(r.bucket.toLowerCase());
      if (!exactName) return null;

      return {
        threadId: r.threadId,
        bucket: exactName,
        confidence: r.confidence,
        reason: r.reason,
        category: "",
        actionability: "",
        urgency: "",
        risk: "",
        senderType: "",
      } as DimensionalClassification;
    })
    .filter((r): r is DimensionalClassification => r !== null);
}

function parseResponse(raw: string): LLMClassificationResult[] {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    cleaned = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    try {
      return JSON.parse(cleaned);
    } catch {
      cleaned = cleaned.replace(/\\/g, "");
      return JSON.parse(cleaned);
    }
  }
}

// Legacy export
export function parseClassificationResponse(raw: string): Classification[] {
  return parseResponse(raw).map((r) => ({
    threadId: r.threadId,
    bucket: r.bucket,
    confidence: r.confidence,
    reason: r.reason,
    category: "",
    actionability: "",
    urgency: "",
    risk: "",
    senderType: "",
  }));
}
