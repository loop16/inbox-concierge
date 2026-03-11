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

export interface DimensionalResult {
  threadId: string;
  category: string;
  actionability: string;
  urgency: string;
  risk: string;
  sender_type: string;
  reason: string;
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

// ── Map dimensions → bucket ──

function mapDimensionsToBucket(
  d: DimensionalResult,
  buckets: BucketDef[],
): { bucket: string; confidence: number; reason: string } {
  const has = (name: string) => buckets.some((b) => b.name.toLowerCase() === name.toLowerCase());

  // High risk → Action Required
  if (d.risk === "high") {
    const target = has("Action Required") ? "Action Required" : "Important";
    return { bucket: target, confidence: 0.95, reason: `High risk: ${d.reason}` };
  }

  // High actionability → Action Required
  if (d.actionability === "high") {
    const target = has("Action Required") ? "Action Required" : "Important";
    return { bucket: target, confidence: 0.9, reason: `Action needed: ${d.reason}` };
  }

  // Newsletters / bulk
  if (d.sender_type === "bulk" || d.category === "newsletter") {
    if (has("Newsletters")) return { bucket: "Newsletters", confidence: 0.9, reason: `Bulk/newsletter: ${d.reason}` };
  }

  // Finance
  if (d.category === "finance" || d.category === "commerce") {
    if (has("Finance / Receipts")) return { bucket: "Finance / Receipts", confidence: 0.85, reason: `Financial: ${d.reason}` };
  }

  // Travel
  if (d.category === "travel") {
    if (has("Travel")) return { bucket: "Travel", confidence: 0.85, reason: `Travel: ${d.reason}` };
    if (has("Can Wait")) return { bucket: "Can Wait", confidence: 0.75, reason: `Travel: ${d.reason}` };
  }

  // Recruiting
  if (d.category === "recruiting") {
    if (has("Recruiting / Job")) return { bucket: "Recruiting / Job", confidence: 0.85, reason: `Recruiting: ${d.reason}` };
  }

  // Social media
  if (d.category === "social") {
    if (has("Auto-Archive")) return { bucket: "Auto-Archive", confidence: 0.8, reason: `Social: ${d.reason}` };
  }

  // Personal from real people with urgency → Important
  if (d.sender_type === "person" && (d.urgency === "high" || d.urgency === "medium")) {
    if (has("Important")) return { bucket: "Important", confidence: 0.85, reason: `Personal, ${d.urgency} urgency: ${d.reason}` };
  }

  // Personal from real people → Personal
  if (d.sender_type === "person") {
    if (has("Personal")) return { bucket: "Personal", confidence: 0.8, reason: `Personal: ${d.reason}` };
  }

  // Service, no action, low urgency → Auto-Archive
  if (d.sender_type === "service" && d.actionability === "none" && d.urgency === "low") {
    if (has("Auto-Archive")) return { bucket: "Auto-Archive", confidence: 0.8, reason: `Low-priority notification: ${d.reason}` };
  }

  // Service → Can Wait
  if (d.sender_type === "service") {
    if (has("Can Wait")) return { bucket: "Can Wait", confidence: 0.75, reason: `Service notification: ${d.reason}` };
  }

  // Custom bucket matching
  for (const bucket of buckets) {
    if (!bucket.isDefault && bucket.description) {
      const desc = bucket.description.toLowerCase();
      const reason = d.reason.toLowerCase();
      const cat = d.category.toLowerCase();
      if (desc.includes(cat) || reason.split(" ").some((w) => w.length > 3 && desc.includes(w))) {
        return { bucket: bucket.name, confidence: 0.7, reason: `Matched custom bucket: ${d.reason}` };
      }
    }
  }

  // Fallback
  if (d.urgency === "medium" || d.actionability === "low") {
    if (has("Can Wait")) return { bucket: "Can Wait", confidence: 0.6, reason: d.reason };
  }

  return { bucket: has("Can Wait") ? "Can Wait" : buckets[0]?.name || "Can Wait", confidence: 0.5, reason: d.reason };
}

// ── Guardrail: protect critical emails from auto-archive ──

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

export async function classifyWithLLM(
  client: OpenAI,
  model: string,
  threads: ThreadSummary[],
  buckets: BucketDef[],
): Promise<DimensionalClassification[]> {
  // Trim inputs for speed
  const trimmedThreads = threads.map((t) => ({
    threadId: t.id,
    subject: t.subject.slice(0, 100),
    sender: t.sender.slice(0, 50),
    senderEmail: t.senderEmail,
    snippet: t.snippet.slice(0, 150),
  }));

  const prompt = `Classify each email on these dimensions:

1. category: personal | work | finance | commerce | travel | newsletter | social | system | recruiting
2. actionability: none | low | high
3. urgency: low | medium | high
4. risk: low | medium | high
5. sender_type: person | service | bulk | unknown

Threads:
${JSON.stringify(trimmedThreads)}

JSON array only:
[{"threadId":"...","category":"...","actionability":"...","urgency":"...","risk":"...","sender_type":"...","reason":"10 words max"}]`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "Email classifier. JSON only, no markdown." },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0]?.message?.content || "";
  const dimensional = parseDimensionalResponse(text);

  // Build threadId → summary map for guardrails
  const threadMap = new Map(threads.map((t) => [t.id, t]));

  // Map dimensions → buckets, apply guardrails
  return dimensional.map((d) => {
    const mapped = mapDimensionsToBucket(d, buckets);
    const thread = threadMap.get(d.threadId);

    const result: DimensionalClassification = {
      threadId: d.threadId,
      bucket: mapped.bucket,
      confidence: mapped.confidence,
      reason: mapped.reason,
      category: d.category,
      actionability: d.actionability,
      urgency: d.urgency,
      risk: d.risk,
      senderType: d.sender_type,
    };

    if (thread) {
      return applyGuardrails(result, thread.subject, thread.senderEmail, buckets);
    }
    return result;
  });
}

function parseDimensionalResponse(raw: string): DimensionalResult[] {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

// Legacy export
export function parseClassificationResponse(raw: string): Classification[] {
  return parseDimensionalResponse(raw).map((d) => ({
    threadId: d.threadId,
    bucket: "",
    confidence: 0,
    reason: d.reason,
    category: d.category,
    actionability: d.actionability,
    urgency: d.urgency,
    risk: d.risk,
    senderType: d.sender_type,
  }));
}
