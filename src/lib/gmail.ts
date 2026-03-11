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
    `${GMAIL_BASE}/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
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

export class GmailError extends Error {
  constructor(public status: number, public body: string) {
    super(`Gmail API error ${status}`);
  }
}
