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

  // Sample up to 80 recent threads
  const threads = await prisma.thread.findMany({
    where: { userId: auth.user.id },
    orderBy: { date: "desc" },
    take: 80,
    select: {
      subject: true,
      sender: true,
      senderEmail: true,
      snippet: true,
    },
  });

  if (threads.length < 3) {
    return NextResponse.json({ error: "Need at least a few emails to suggest buckets. Sync first." }, { status: 400 });
  }

  const prompt = `You are analyzing a user's email inbox to suggest personalized categories (we call them "buckets") for organizing their emails.

Here is a sample of ${threads.length} recent emails:

${JSON.stringify(threads.map((t) => ({
  subject: t.subject,
  from: `${t.sender} <${t.senderEmail}>`,
  preview: t.snippet.slice(0, 100),
})))}

Based on the actual content and patterns you see, suggest 5-9 buckets that would best organize THIS person's inbox. Be specific to their life — don't use generic categories unless they clearly fit.

Guidelines:
- Look for patterns: recurring senders, topics, types of communication
- Name buckets clearly and concisely (2-4 words)
- Always include an "Action Required" bucket first for urgent/time-sensitive items
- Always include an "Important" bucket for emails that need attention but aren't urgent
- Always include a "Newsletters" bucket for marketing, promotions, and bulk emails
- Always include a catch-all bucket (like "Other" or "Low Priority") as the last one
- Each bucket should have a clear description and 2-3 example senders/subjects from the actual emails
- Be specific: "GitHub Notifications" is better than "Tech", "Subscription Receipts" is better than "Finance"
- Do NOT create overlapping buckets — each email should clearly belong to one bucket

Respond with JSON only. No markdown. No backticks. Format:
[
  {
    "name": "Bucket Name",
    "description": "What goes here",
    "examples": "e.g., emails from x@y.com, subjects about Z"
  }
]`;

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
    });

    const text = response.choices[0]?.message?.content || "";
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let suggestions;
    try {
      suggestions = JSON.parse(cleaned);
    } catch {
      // Fix bad escape characters the LLM sometimes produces
      cleaned = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
      try {
        suggestions = JSON.parse(cleaned);
      } catch {
        // Last resort: strip all backslashes that aren't part of valid JSON escapes
        cleaned = cleaned.replace(/\\/g, "");
        suggestions = JSON.parse(cleaned);
      }
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Bucket suggestion error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate suggestions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
