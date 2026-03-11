import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.imapAccount.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      label: true,
      email: true,
      imapHost: true,
      imapPort: true,
      imapTls: true,
      connected: true,
      lastSyncAt: true,
      lastError: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { label, email, imapHost, imapPort, password, imapTls } = body;

  if (!label || !email || !imapHost || !password) {
    return NextResponse.json(
      { error: "Label, email, host, and password are required" },
      { status: 400 }
    );
  }

  try {
    const encryptedPassword = encrypt(password);

    const account = await prisma.imapAccount.upsert({
      where: {
        userId_email: { userId: auth.user.id, email },
      },
      update: {
        label,
        imapHost,
        imapPort: imapPort || 993,
        imapTls: imapTls !== false,
        password: encryptedPassword,
        connected: true,
        lastError: null,
      },
      create: {
        userId: auth.user.id,
        label,
        email,
        imapHost,
        imapPort: imapPort || 993,
        imapTls: imapTls !== false,
        password: encryptedPassword,
        connected: true,
      },
    });

    return NextResponse.json({
      id: account.id,
      label: account.label,
      email: account.email,
      imapHost: account.imapHost,
      connected: account.connected,
    });
  } catch (err: unknown) {
    console.error("IMAP account add error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
