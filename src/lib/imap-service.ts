import { ImapFlow } from "imapflow";

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  email: string;
  password: string;
}

export interface ImapThreadSummary {
  uid: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  date: Date;
}

export async function testImapConnection(creds: ImapCredentials): Promise<{
  success: boolean;
  error?: string;
  mailboxCount?: number;
}> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
  });
  try {
    await client.connect();
    const mailbox = await client.status("INBOX", { messages: true });
    await client.logout();
    return { success: true, mailboxCount: mailbox.messages };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, error: message };
  }
}

export async function fetchImapMessages(
  creds: ImapCredentials,
  maxResults = 200
): Promise<ImapThreadSummary[]> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.email, pass: creds.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  try {
    const messages: ImapThreadSummary[] = [];
    const mailbox = client.mailbox;
    const totalMessages = mailbox && typeof mailbox === "object" && "exists" in mailbox ? (mailbox.exists as number) : 0;

    if (totalMessages === 0) return [];

    const startSeq = Math.max(1, totalMessages - maxResults + 1);

    for await (const msg of client.fetch(`${startSeq}:*`, {
      envelope: true,
      bodyStructure: true,
    })) {
      const from = msg.envelope?.from?.[0];
      messages.push({
        uid: msg.uid.toString(),
        subject: msg.envelope?.subject || "(no subject)",
        sender: from?.name || from?.address || "Unknown",
        senderEmail: from?.address || "",
        snippet: "",
        date: msg.envelope?.date || new Date(),
      });
    }

    return messages.reverse();
  } finally {
    lock.release();
    await client.logout();
  }
}
