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

export async function fetchImapMessageBody(
  creds: ImapCredentials,
  uid: number,
): Promise<string> {
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
    const message = await client.fetchOne(uid.toString(), { source: true }, { uid: true });
    if (!message) return "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (message as any).source?.toString("utf-8") as string | undefined;
    if (!raw) return "";

    // Extract text body from raw email
    // Check for multipart boundary
    const boundaryMatch = raw.match(/boundary="?([^"\s;]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = raw.split(`--${boundary}`);
      // Find text/plain part
      for (const part of parts) {
        if (/content-type:\s*text\/plain/i.test(part)) {
          const bodyStart = part.indexOf("\r\n\r\n");
          if (bodyStart === -1) continue;
          let body = part.slice(bodyStart + 4).trim();
          // Remove trailing boundary marker
          body = body.replace(/--\s*$/, "").trim();
          // Handle quoted-printable
          if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
            body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_match: string, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            );
          }
          // Handle base64
          if (/content-transfer-encoding:\s*base64/i.test(part)) {
            body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf-8");
          }
          return body.slice(0, 15000);
        }
      }
      // Fallback: try text/html with tags stripped
      for (const part of parts) {
        if (/content-type:\s*text\/html/i.test(part)) {
          const bodyStart = part.indexOf("\r\n\r\n");
          if (bodyStart === -1) continue;
          let body = part.slice(bodyStart + 4).trim();
          body = body.replace(/--\s*$/, "").trim();
          if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
            body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_match: string, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            );
          }
          if (/content-transfer-encoding:\s*base64/i.test(part)) {
            body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf-8");
          }
          return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 15000);
        }
      }
    }

    // Non-multipart: extract body after headers
    const bodyStart = raw.indexOf("\r\n\r\n");
    if (bodyStart !== -1) {
      return raw.slice(bodyStart + 4).trim().slice(0, 15000);
    }

    return "";
  } finally {
    lock.release();
    await client.logout();
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
