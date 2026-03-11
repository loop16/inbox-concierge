import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLLMClient, getLLMModel } from "@/lib/llm-client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const thread = await prisma.thread.findFirst({
    where: { id, userId: auth.user.id },
    include: { bucket: true },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const client = getLLMClient();
  if (!client) {
    return NextResponse.json({ error: "No AI provider configured" }, { status: 503 });
  }

  const model = getLLMModel();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "You summarize emails concisely. Be direct and useful. No filler.",
      },
      {
        role: "user",
        content: `Summarize this email in 1-2 sentences. If there's an action needed, state it clearly.

Subject: ${thread.subject}
From: ${thread.sender} <${thread.senderEmail}>
Preview: ${thread.snippet}
${thread.bucket ? `Bucket: ${thread.bucket.name}` : ""}

Respond with JSON only: {"summary":"...","action":"..." or null}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || "";

  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const result = JSON.parse(cleaned);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ summary: text.trim(), action: null });
  }
}
