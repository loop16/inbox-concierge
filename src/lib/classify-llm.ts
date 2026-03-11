import OpenAI from "openai";

export interface ThreadSummary {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
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

// ── Guardrail patterns ──

const PROTECTED_SUBJECT_PATTERNS = [
  /security alert/i, /fraud/i, /unauthorized/i, /suspicious/i,
  /payment fail/i, /card decline/i, /account (compromis|lock|suspend|restrict)/i,
  /password (reset|change|expire)/i, /verify your (identity|account|email)/i,
  /unusual (sign.in|activity|login)/i, /new (sign.in|device|login)/i,
  /tax (document|return|notice)/i, /legal notice/i, /court/i, /subpoena/i,
  /wire transfer/i, /past due/i, /final notice/i, /collections/i,
  /data breach/i, /privacy incident/i,
  /flight (cancel|delay|change)/i, /booking (cancel|change)/i,
  /delivery fail/i, /package return/i,
];

const PROTECTED_SENDER_PATTERNS = [
  /bank|chase|wellsfargo|citi|amex|visa|mastercard|discover/i,
  /paypal|venmo|cashapp|zelle|wise|transferwise/i,
  /irs\.gov|treasury\.gov/i,
  /security|auth0|okta|duo|lastpass|1password/i,
];

// ── Guardrail: protect critical emails from low-priority buckets ──

function applyGuardrails(
  result: DimensionalClassification,
  subject: string,
  senderEmail: string,
  buckets: BucketDef[],
): DimensionalClassification {
  const isProtected =
    PROTECTED_SUBJECT_PATTERNS.some((p) => p.test(subject)) ||
    PROTECTED_SENDER_PATTERNS.some((p) => p.test(senderEmail));

  if (!isProtected) return result;

  const lowPriorityBuckets = ["auto-archive", "newsletters", "can wait"];
  if (lowPriorityBuckets.includes(result.bucket.toLowerCase())) {
    const has = (name: string) => buckets.some((b) => b.name.toLowerCase() === name.toLowerCase());
    const target = has("Important") ? "Important" : has("Action Required") ? "Action Required" : result.bucket;
    if (target !== result.bucket) {
      return {
        ...result,
        bucket: target,
        confidence: 0.95,
        reason: `Protected: ${result.reason}. Rescued from ${result.bucket} — security/financial signals.`,
        risk: "high",
      };
    }
  }

  return result;
}

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
): Promise<DimensionalClassification[]> {
  const trimmedThreads = threads.map((t) => ({
    id: t.id,
    subject: t.subject.slice(0, 120),
    from: `${t.sender} <${t.senderEmail}>`,
    preview: t.snippet.slice(0, 200),
  }));

  const bucketList = buckets.map((b) => {
    let desc = `- "${b.name}"`;
    if (b.description) desc += `: ${b.description}`;
    if (b.examples) desc += ` (e.g. ${b.examples})`;
    return desc;
  }).join("\n");

  const prompt = `You are an email classifier. Classify each email into EXACTLY ONE of these buckets:

${bucketList}

RULES:
- Read each email's subject, sender, and preview carefully
- Choose the SINGLE most appropriate bucket based on the email's actual content and sender
- Political emails go to newsletters/updates buckets, NOT finance/trading buckets
- Marketing, promotions, and bulk emails are newsletters
- Personal emails from real people (not companies) go to personal/important buckets
- Only use "Action Required" or "Important" for emails that genuinely need a response or attention
- When unsure, prefer a general bucket over a specific wrong one
- confidence: 0.0-1.0 (how sure you are)
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

  // Validate bucket names and build results
  const bucketNames = new Set(buckets.map((b) => b.name));
  const threadMap = new Map(threads.map((t) => [t.id, t]));

  return parsed
    .filter((r) => bucketNames.has(r.bucket))
    .map((r) => {
      const result: DimensionalClassification = {
        threadId: r.threadId,
        bucket: r.bucket,
        confidence: r.confidence,
        reason: r.reason,
        category: "",
        actionability: "",
        urgency: "",
        risk: "",
        senderType: "",
      };

      const thread = threadMap.get(r.threadId);
      if (thread) {
        return applyGuardrails(result, thread.subject, thread.senderEmail, buckets);
      }
      return result;
    });
}

function parseResponse(raw: string): LLMClassificationResult[] {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fix bad escapes
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
