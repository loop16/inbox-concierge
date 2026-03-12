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
  ruleReasons?: Map<string, string>,
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
    // Include rule suggestion for AI to verify
    const hint = ruleHints?.get(t.id);
    if (hint) {
      entry.suggested = hint;
      const reason = ruleReasons?.get(t.id);
      if (reason) entry.ruleReason = reason;
    }
    return entry;
  });

  const bucketList = buckets.map((b) => {
    let desc = `- "${b.name}"`;
    if (b.description) desc += `: ${b.description}`;
    if (b.examples) desc += ` (e.g. ${b.examples})`;
    return desc;
  }).join("\n");

  // Split threads into rule-matched and unmatched for clearer AI instructions
  const ruleMatched = trimmedThreads.filter((t) => t.suggested);
  const unmatched = trimmedThreads.filter((t) => !t.suggested);

  let emailSection = "";
  if (ruleMatched.length > 0) {
    emailSection += `RULE-MATCHED EMAILS (${ruleMatched.length}) — these were pre-classified by rules. KEEP the suggested bucket UNLESS it is obviously wrong:\n${JSON.stringify(ruleMatched)}\n\n`;
  }
  if (unmatched.length > 0) {
    emailSection += `UNCLASSIFIED EMAILS (${unmatched.length}) — classify these from scratch:\n${JSON.stringify(unmatched)}`;
  }

  const prompt = `You are an email classifier. Classify emails into the user's buckets.

BUCKETS (the ONLY valid categories):
${bucketList}

PIPELINE:
1. RULE-MATCHED emails have a "suggested" bucket from our rule engine. These rules matched based on keywords, sender patterns, or Gmail labels. You MUST keep the suggested bucket UNLESS it is clearly wrong (e.g. a personal email suggested as "Newsletters"). When keeping it, set confidence to 0.9+.
2. UNCLASSIFIED emails have no rule match. Classify these from scratch based on subject, sender, and preview.
3. Emails with "hasUnsubscribe": true have an unsubscribe header — strong signal for newsletters/marketing/auto-archive.

RULES:
- Use bucket names EXACTLY as written (case-sensitive)
- confidence: 0.0-1.0
- reason: brief explanation (10 words max)
- If unsure, use the most general/catch-all bucket

${emailSection}

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
