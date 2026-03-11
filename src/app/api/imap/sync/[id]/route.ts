import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchImapMessages } from "@/lib/imap-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const account = await prisma.imapAccount.findFirst({
    where: { id, userId: auth.user.id },
  });

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    const password = decrypt(account.password);
    const messages = await fetchImapMessages({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapTls,
      email: account.email,
      password,
    });

    let synced = 0;
    for (const msg of messages) {
      await prisma.thread.upsert({
        where: {
          userId_gmailThreadId: {
            userId: auth.user.id,
            gmailThreadId: `imap-${account.id}-${msg.uid}`,
          },
        },
        update: {
          subject: msg.subject,
          sender: msg.sender,
          senderEmail: msg.senderEmail,
          snippet: msg.snippet,
          date: msg.date,
        },
        create: {
          gmailThreadId: `imap-${account.id}-${msg.uid}`,
          subject: msg.subject,
          sender: msg.sender,
          senderEmail: msg.senderEmail,
          snippet: msg.snippet,
          date: msg.date,
          userId: auth.user.id,
          provider: account.id,
          providerLabel: account.label,
        },
      });
      synced++;
    }

    await prisma.imapAccount.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastError: null, connected: true },
    });

    return NextResponse.json({ synced });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    await prisma.imapAccount.update({
      where: { id },
      data: { lastError: message, connected: false },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
