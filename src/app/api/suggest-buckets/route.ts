import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLLMClient, getLLMModel } from "@/lib/llm-client";

export async function POST() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getLLMClient();
  const model = getLLMModel();
  if (!client) {
    return NextResponse.json({ error: "AI classification is temporarily unavailable" }, { status: 503 });
  }

  // Load existing buckets and sample threads in parallel
  const [existingBuckets, threads] = await Promise.all([
    prisma.bucket.findMany({
      where: { userId: auth.user.id },
      select: { name: true },
    }),
    prisma.thread.findMany({
      where: { userId: auth.user.id },
      orderBy: { date: "desc" },
      take: 40,
      select: {
        subject: true,
        senderEmail: true,
        snippet: true,
      },
    }),
  ]);

  if (threads.length < 3) {
    return NextResponse.json({ error: "Need at least a few emails to suggest buckets. Sync first." }, { status: 400 });
  }

  const existingNames = existingBuckets.map((b) => b.name).join(", ");

  const prompt = `The user already has these buckets: ${existingNames}

Suggest 2-5 NEW buckets for emails that don't fit the existing ones. Do NOT suggest buckets similar to existing ones.

Sample emails:
${JSON.stringify(threads.map((t) => ({ s: t.subject.slice(0, 60), f: t.senderEmail, p: t.snippet.slice(0, 80) })))}

Return JSON: {"suggestions":[{"name":"...","description":"...","examples":"..."}]}
Return empty array if no new buckets needed: {"suggestions":[]}`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an email organization expert. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const text = response.choices[0]?.message?.content || "";
    console.log(`[SUGGEST] Model: ${model}, response length: ${text.length}`);
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      cleaned = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        cleaned = cleaned.replace(/\\/g, "");
        parsed = JSON.parse(cleaned);
      }
    }

    // Handle wrapped responses like {"suggestions": [...]} or {"buckets": [...]}
    let suggestions;
    if (Array.isArray(parsed)) {
      suggestions = parsed;
    } else if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed as Record<string, unknown>);
      suggestions = values.find((v) => Array.isArray(v)) || [];
    } else {
      suggestions = [];
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Bucket suggestion error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate suggestions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
