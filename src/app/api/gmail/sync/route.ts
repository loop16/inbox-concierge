import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { fetchThreadList, fetchThreadDetail, GmailError } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchImapMessages } from "@/lib/imap-service";
import { rateLimit } from "@/lib/rate-limit";

// Allow up to 60 seconds for sync on Vercel
export const maxDuration = 60;

export async function POST() {
  const auth = await getAuthSession();
  if (!auth || !auth.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 10 sync requests per hour
  const rl = rateLimit(`sync:${auth.user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }

  // Update lastActiveAt
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { lastActiveAt: new Date() },
  });

  const results: { gmail: number; imap: Record<string, number>; errors: string[] } = {
    gmail: 0,
    imap: {},
    errors: [],
  };

  // 1. Sync Gmail
  try {
    const threadIds = await fetchThreadList(auth.accessToken);

    for (let i = 0; i < threadIds.length; i += 10) {
      const batch = threadIds.slice(i, i + 10);
      const threads = await Promise.all(
        batch.map((id) => fetchThreadDetail(auth.accessToken!, id))
      );

      for (const thread of threads) {
        await prisma.thread.upsert({
          where: {
            userId_gmailThreadId: {
              userId: auth.user.id,
              gmailThreadId: thread.gmailThreadId,
            },
          },
          update: {
            subject: thread.subject,
            sender: thread.sender,
            senderEmail: thread.senderEmail,
            snippet: thread.snippet,
            date: thread.date,
            labelIds: JSON.stringify(thread.labelIds),
            hasUnsubscribe: thread.hasUnsubscribe,
          },
          create: {
            gmailThreadId: thread.gmailThreadId,
            subject: thread.subject,
            sender: thread.sender,
            senderEmail: thread.senderEmail,
            snippet: thread.snippet,
            date: thread.date,
            labelIds: JSON.stringify(thread.labelIds),
            hasUnsubscribe: thread.hasUnsubscribe,
            userId: auth.user.id,
            provider: "gmail",
            providerLabel: "Gmail",
          },
        });
        results.gmail++;
      }
    }
  } catch (error) {
    console.error("[SYNC] Gmail sync error:", error);
    if (error instanceof GmailError) {
      if (error.status === 401) {
        return NextResponse.json({ error: "Gmail token expired. Please sign out and sign in again." }, { status: 401 });
      }
      if (error.status === 429) {
        return NextResponse.json({ error: "Rate limited" }, { status: 429 });
      }
    }
    results.errors.push(`Gmail: ${error instanceof Error ? error.message : "Sync failed"}`);
  }

  // 2. Sync all IMAP accounts
  const imapAccounts = await prisma.imapAccount.findMany({
    where: { userId: auth.user.id, connected: true },
  });

  for (const account of imapAccounts) {
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

      results.imap[account.label] = synced;
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: { lastSyncAt: new Date(), lastError: null },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sync failed";
      results.errors.push(`${account.label}: ${message}`);
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: { lastError: message, connected: false },
      });
    }
  }

  const totalImap = Object.values(results.imap).reduce((s, n) => s + n, 0);

  return NextResponse.json({
    synced: results.gmail + totalImap,
    gmail: results.gmail,
    imap: results.imap,
    errors: results.errors.length > 0 ? results.errors : undefined,
  });
}
