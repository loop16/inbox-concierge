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
  const trimmed = threads.map((t) => {
    const entry: Record<string, string | boolean> = {
      id: t.id,
      subject: t.subject.slice(0, 80),
      from: t.senderEmail,
      preview: t.snippet.slice(0, 100),
    };
    if (t.hasUnsubscribe) entry.unsub = true;
    const hint = ruleHints?.get(t.id);
    if (hint) entry.suggested = hint;
    return entry;
  });

  // Build bucket list with descriptions so AI understands each bucket
  const bucketLines = buckets.map((b) => {
    let line = `- "${b.name}"`;
    if (b.description) line += `: ${b.description}`;
    if (b.examples) line += ` (e.g. ${b.examples})`;
    return line;
  }).join("\n");

  const prompt = `Classify each email into EXACTLY one of these buckets:

${bucketLines}

STRICT RULES (follow these carefully):
- "Finance / Receipts" is ONLY for actual charges, bills, invoices, payment confirmations, receipts, subscription renewals, refunds, bank statements. NOT for account notifications, marketing, or promotional emails from financial platforms.
- "Action Required" is ONLY for emails where YOU personally must take a specific action (reply, sign, approve, verify identity, pay). NOT for marketing urgency like "sale ending soon" or "don't miss out". Safety warnings and promotional urgency are NOT action required.
- "Important" is for personal emails from real humans that need attention. NOT for automated job application confirmations, social media notifications, or marketing.
- "Recruiting / Job" is for job-related: applications, recruiter outreach, interview scheduling, offer letters, "thanks for applying".
- Social media notifications (Facebook, Instagram, LinkedIn messages, Twitter) → "Notifications" or "Auto-Archive", NOT "Important".
- Account welcome emails, API credit top-ups, platform funding notifications → "Finance / Receipts" ONLY if it's an actual charge/payment. If it's just a notification → "Notifications" or "Auto-Archive".
- If "unsub" is true, it's almost certainly a newsletter or marketing email → "Newsletters".
- If an email has "suggested", keep that bucket unless clearly wrong based on the rules above.
- Every email MUST be classified. Use the EXACT bucket name including spaces and slashes.

Emails:
${JSON.stringify(trimmed)}

Return JSON: {"results":[{"threadId":"<the id field>","bucket":"<exact bucket name>","confidence":0.9,"reason":"short reason"}]}
threadId must match the "id" field exactly.`;

  const t0 = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You classify emails into predefined buckets. Always respond with valid JSON. Use exact bucket names as provided." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const elapsed = Date.now() - t0;

  const text = response.choices[0]?.message?.content || "";
  console.log(`[LLM] ${model} ${threads.length} emails in ${elapsed}ms, ${text.length} chars`);
  const parsed = parseResponse(text);

  // Build fuzzy bucket name matching
  const bucketNameSet = new Set(buckets.map((b) => b.name));
  const bucketNamesLower = new Map(buckets.map((b) => [b.name.toLowerCase(), b.name]));
  // Also match with normalized spaces/slashes: "Finance/Receipts" → "Finance / Receipts"
  const bucketNamesNormalized = new Map<string, string>();
  for (const b of buckets) {
    const normalized = b.name.toLowerCase().replace(/\s+/g, "").replace(/\//g, "/");
    bucketNamesNormalized.set(normalized, b.name);
  }

  const resolveBucketName = (raw: string): string | undefined => {
    if (bucketNameSet.has(raw)) return raw;
    const lower = raw.toLowerCase();
    if (bucketNamesLower.has(lower)) return bucketNamesLower.get(lower);
    const normalized = lower.replace(/\s+/g, "").replace(/\//g, "/");
    if (bucketNamesNormalized.has(normalized)) return bucketNamesNormalized.get(normalized);
    // Try partial match: if the LLM returned a substring of a bucket name
    for (const [key, name] of bucketNamesLower) {
      if (key.includes(lower) || lower.includes(key)) return name;
    }
    return undefined;
  };

  // Normalize: support both compact {t,b,c,n} and full {threadId,bucket,confidence,reason}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized: LLMClassificationResult[] = parsed.map((r: any) => ({
    threadId: (r.t || r.threadId || r.id || "") as string,
    bucket: (r.b || r.bucket || "") as string,
    confidence: (r.c ?? r.confidence ?? 0.5) as number,
    reason: (r.n || r.reason || "") as string,
  }));

  const results = normalized
    .map((r) => {
      const resolvedName = resolveBucketName(r.bucket);
      if (!resolvedName) return null;

      return {
        threadId: r.threadId,
        bucket: resolvedName,
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

  const unmatched = normalized.filter((r) => !resolveBucketName(r.bucket));
  if (unmatched.length > 0) {
    console.warn(`[LLM] Unmatched bucket names from AI:`, unmatched.map((c) => c.bucket));
    console.warn(`[LLM] Available buckets:`, buckets.map((b) => b.name));
  }
  console.log(`[LLM] Matched ${results.length}/${normalized.length} classifications`);

  return results;
}

function parseResponse(raw: string): LLMClassificationResult[] {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  const extract = (data: unknown): LLMClassificationResult[] => {
    if (Array.isArray(data)) return data;
    // Handle wrapped responses like {"results": [...]} or {"classifications": [...]}
    if (data && typeof data === "object") {
      const values = Object.values(data as Record<string, unknown>);
      for (const v of values) {
        if (Array.isArray(v)) return v;
      }
    }
    return [];
  };

  try {
    return extract(JSON.parse(cleaned));
  } catch {
    cleaned = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    try {
      return extract(JSON.parse(cleaned));
    } catch {
      cleaned = cleaned.replace(/\\/g, "");
      return extract(JSON.parse(cleaned));
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
