import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLLMClient, getLLMModel } from "@/lib/llm-client";

export async function POST() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update lastActiveAt
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { lastActiveAt: new Date() },
  });

  // Load recent threads (last 7 days, classified)
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const threads = await prisma.thread.findMany({
    where: {
      userId: auth.user.id,
      bucketId: { not: null },
      date: { gte: since },
    },
    include: {
      bucket: { select: { name: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  if (threads.length === 0) {
    return NextResponse.json({ top: [], method: "none" });
  }

  // Score threads using dimensional data
  const scored = threads.map((t) => {
    let score = 0;

    // Urgency
    if (t.aiUrgency === "high") score += 30;
    else if (t.aiUrgency === "medium") score += 15;

    // Actionability
    if (t.aiActionability === "high") score += 25;
    else if (t.aiActionability === "low") score += 10;

    // Risk
    if (t.aiRisk === "high") score += 20;
    else if (t.aiRisk === "medium") score += 10;

    // Personal emails from real people score higher
    if (t.aiSenderType === "person") score += 15;

    // Recency bonus (newer = higher)
    const ageHours = (Date.now() - new Date(t.date).getTime()) / (1000 * 60 * 60);
    if (ageHours < 6) score += 15;
    else if (ageHours < 24) score += 10;
    else if (ageHours < 48) score += 5;

    // Penalize bulk/newsletters
    if (t.aiSenderType === "bulk") score -= 20;
    if (t.bucket?.name === "Newsletters") score -= 15;
    if (t.bucket?.name === "Auto-Archive") score -= 25;

    return { thread: t, score };
  });

  // Sort by score, take top candidates
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, 20);

  // Try LLM for final ranking with explanations
  const client = getLLMClient();
  const model = getLLMModel();

  if (client) {
    try {
      const prompt = `You are an email priority assistant. From these ${candidates.length} emails, pick the TOP 5 that the user most needs to see right now. Prioritize:
- Emails requiring a response or action
- Time-sensitive items
- Personal messages from real people
- Financial/security alerts
- Interesting or important content

Emails:
${JSON.stringify(candidates.map((c, i) => ({
  idx: i,
  subject: c.thread.subject.slice(0, 100),
  sender: c.thread.sender.slice(0, 50),
  senderEmail: c.thread.senderEmail,
  snippet: c.thread.snippet.slice(0, 150),
  bucket: c.thread.bucket?.name,
  urgency: c.thread.aiUrgency,
  actionability: c.thread.aiActionability,
  risk: c.thread.aiRisk,
  senderType: c.thread.aiSenderType,
})))}

Return JSON only:
[{"idx": 0, "why": "10 word max reason why this email matters"}, ...]

Pick exactly 5. JSON array only, no markdown.`;

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "Email priority ranker. JSON only." },
          { role: "user", content: prompt },
        ],
      });

      const text = response.choices[0]?.message?.content || "";
      const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      const picks: { idx: number; why: string }[] = JSON.parse(cleaned);

      const top = picks
        .filter((p) => p.idx >= 0 && p.idx < candidates.length)
        .slice(0, 5)
        .map((p) => {
          const t = candidates[p.idx].thread;
          return {
            id: t.id,
            subject: t.subject,
            sender: t.sender,
            senderEmail: t.senderEmail,
            snippet: t.snippet,
            date: t.date,
            bucket: t.bucket?.name || null,
            provider: t.provider,
            providerLabel: t.providerLabel,
            aiUrgency: t.aiUrgency,
            aiRisk: t.aiRisk,
            why: p.why,
          };
        });

      return NextResponse.json({ top, method: "ai" });
    } catch (e) {
      console.warn("Top emails LLM failed:", (e as Error).message);
      // Fall through to score-based
    }
  }

  // Fallback: just use score ranking
  const top = candidates.slice(0, 5).map((c) => ({
    id: c.thread.id,
    subject: c.thread.subject,
    sender: c.thread.sender,
    senderEmail: c.thread.senderEmail,
    snippet: c.thread.snippet,
    date: c.thread.date,
    bucket: c.thread.bucket?.name || null,
    provider: c.thread.provider,
    providerLabel: c.thread.providerLabel,
    aiUrgency: c.thread.aiUrgency,
    aiRisk: c.thread.aiRisk,
    why: c.thread.aiActionability === "high"
      ? "Needs your response"
      : c.thread.aiUrgency === "high"
      ? "Time-sensitive"
      : c.thread.aiSenderType === "person"
      ? "Personal message"
      : "High priority",
  }));

  return NextResponse.json({ top, method: "score" });
}
