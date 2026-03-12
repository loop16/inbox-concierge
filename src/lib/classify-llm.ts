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
  // Compact thread format: [id, subject, sender, preview, hint?]
  const compact = threads.map((t) => {
    const row: (string | boolean)[] = [
      t.id,
      t.subject.slice(0, 80),
      t.senderEmail,
      t.snippet.slice(0, 100),
    ];
    if (t.hasUnsubscribe) row.push(true); // index 4 = unsub
    const hint = ruleHints?.get(t.id);
    if (hint) row.push(hint); // index 4 or 5 = suggested bucket
    return row;
  });

  const bucketNames = buckets.map((b) => b.name).join(", ");

  const prompt = `Classify these emails into buckets: ${bucketNames}

Format: [id, subject, sender, preview, unsub?, suggested?]
Emails with "suggested" = keep that bucket unless clearly wrong.
unsub=true → likely newsletter/marketing.
Receipts/orders/rides → "Finance / Receipts"

${JSON.stringify(compact)}

Return JSON: {"r":[{"t":"threadId","b":"bucket","c":0.9,"n":"reason"}]}`;

  const t0 = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "Classify emails into buckets. Return JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const elapsed = Date.now() - t0;

  const text = response.choices[0]?.message?.content || "";
  console.log(`[LLM] ${model} ${threads.length} emails in ${elapsed}ms, ${text.length} chars`);
  const parsed = parseResponse(text);

  // Validate bucket names (case-insensitive) and build results
  const bucketNameSet = new Set(buckets.map((b) => b.name));
  const bucketNamesLower = new Map(buckets.map((b) => [b.name.toLowerCase(), b.name]));

  // Normalize: support both compact {t,b,c,n} and full {threadId,bucket,confidence,reason}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized: LLMClassificationResult[] = parsed.map((r: any) => ({
    threadId: (r.t || r.threadId || "") as string,
    bucket: (r.b || r.bucket || "") as string,
    confidence: (r.c ?? r.confidence ?? 0.5) as number,
    reason: (r.n || r.reason || "") as string,
  }));

  return normalized
    .map((r) => {
      const exactName = bucketNameSet.has(r.bucket) ? r.bucket : bucketNamesLower.get(r.bucket.toLowerCase());
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
