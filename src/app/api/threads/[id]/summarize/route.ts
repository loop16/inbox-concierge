import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLLMClient, getSmartModel } from "@/lib/llm-client";
import { fetchThreadBody } from "@/lib/gmail";
import { fetchImapMessageBody } from "@/lib/imap-service";
import { decrypt } from "@/lib/crypto";

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

  // Fetch full email body
  let emailBody = thread.snippet || "";
  const isImap = thread.gmailThreadId.startsWith("imap-");

  if (isImap) {
    // IMAP: parse account ID and UID from gmailThreadId format "imap-{accountId}-{uid}"
    try {
      const parts = thread.gmailThreadId.split("-");
      const accountId = parts.slice(1, -1).join("-"); // account ID (cuid)
      const uid = parseInt(parts[parts.length - 1], 10);
      const account = await prisma.imapAccount.findFirst({
        where: { id: accountId, userId: auth.user.id },
      });
      if (account && !isNaN(uid)) {
        const password = decrypt(account.password);
        emailBody = await fetchImapMessageBody(
          { host: account.imapHost, port: account.imapPort, secure: account.imapTls, email: account.email, password },
          uid,
        );
      }
    } catch (e) {
      console.warn(`[SUMMARIZE] Failed to fetch IMAP body, using snippet:`, (e as Error).message);
    }
  } else if (auth.accessToken && thread.gmailThreadId) {
    // Gmail
    try {
      emailBody = await fetchThreadBody(auth.accessToken, thread.gmailThreadId);
    } catch (e) {
      console.warn(`[SUMMARIZE] Failed to fetch Gmail body, using snippet:`, (e as Error).message);
    }
  }

  const model = getSmartModel();

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "You summarize emails concisely. Be direct and useful. No filler. Always respond with valid JSON.",
      },
      {
        role: "user",
        content: `Summarize this email in 1-2 sentences. If there's an action needed, state it clearly.

Subject: ${thread.subject}
From: ${thread.sender} <${thread.senderEmail}>
${thread.bucket ? `Bucket: ${thread.bucket.name}` : ""}

Full email body:
${emailBody}

Return JSON: {"summary":"...","action":"..." or null}`,
      },
    ],
    response_format: { type: "json_object" },
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
