const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailThread {
  id: string;
  historyId: string;
  messages?: GmailMessage[];
  snippet?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: { name: string; value: string }[];
  };
}

export interface ParsedThread {
  gmailThreadId: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  date: Date;
  labelIds: string[];
  hasUnsubscribe: boolean;
}

export async function fetchThreadList(
  accessToken: string,
  maxResults = 200
): Promise<string[]> {
  const res = await fetch(
    `${GMAIL_BASE}/threads?maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new GmailError(res.status, await res.text());
  }

  const data = await res.json();
  return (data.threads || []).map((t: { id: string }) => t.id);
}

export async function fetchThreadDetail(
  accessToken: string,
  threadId: string
): Promise<ParsedThread> {
  const res = await fetch(
    `${GMAIL_BASE}/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=List-Unsubscribe`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new GmailError(res.status, await res.text());
  }

  const thread: GmailThread = await res.json();
  return parseThread(thread);
}

function parseThread(thread: GmailThread): ParsedThread {
  const firstMessage = thread.messages?.[0];
  const headers = firstMessage?.payload?.headers || [];

  const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject");
  const fromHeader = headers.find((h) => h.name.toLowerCase() === "from");
  const unsubHeader = headers.find((h) => h.name.toLowerCase() === "list-unsubscribe");

  const subject = subjectHeader?.value || "(no subject)";
  const { name: sender, email: senderEmail } = parseFromHeader(
    fromHeader?.value || ""
  );

  const internalDate = firstMessage?.internalDate
    ? new Date(parseInt(firstMessage.internalDate))
    : new Date();

  const labelIds = firstMessage?.labelIds || [];

  return {
    gmailThreadId: thread.id,
    subject,
    sender,
    senderEmail,
    snippet: thread.snippet || firstMessage?.snippet || "",
    date: internalDate,
    labelIds,
    hasUnsubscribe: !!unsubHeader?.value,
  };
}

function parseFromHeader(from: string): { name: string; email: string } {
  // Format: "Name <email@example.com>" or just "email@example.com"
  const match = from.match(/^"?(.+?)"?\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: from, email: from };
}

export async function fetchThreadBody(
  accessToken: string,
  gmailThreadId: string,
): Promise<string> {
  const res = await fetch(
    `${GMAIL_BASE}/threads/${gmailThreadId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new GmailError(res.status, await res.text());
  }

  const thread: GmailThread & { messages?: FullGmailMessage[] } = await res.json();
  const parts: string[] = [];

  for (const msg of thread.messages || []) {
    const text = extractTextFromPayload(msg.payload);
    if (text) parts.push(text);
  }

  return parts.join("\n---\n").slice(0, 15000); // cap to avoid blowing token limits
}

interface FullGmailMessage {
  id: string;
  payload: GmailPayload;
}

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
  headers?: { name: string; value: string }[];
}

function extractTextFromPayload(payload: GmailPayload): string {
  // Prefer text/plain, fall back to text/html stripped of tags
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return base64Decode(payload.body.data);
  }

  if (payload.parts) {
    // Try text/plain first
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return base64Decode(part.body.data);
      }
    }
    // Recurse into multipart
    for (const part of payload.parts) {
      const text = extractTextFromPayload(part);
      if (text) return text;
    }
  }

  // Last resort: html with tags stripped
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = base64Decode(payload.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
}

function base64Decode(data: string): string {
  // Gmail uses URL-safe base64
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

export class GmailError extends Error {
  constructor(public status: number, public body: string) {
    super(`Gmail API error ${status}`);
  }
}
