# Feature: Gmail OAuth + Add Any IMAP Email Account

Read SPEC.md for full project context.

## Overview
Keep Gmail OAuth as the primary sign-in and email provider. Add the ability to connect unlimited additional email accounts via IMAP. This covers Outlook, iCloud, Yahoo, work email, university email — anything with IMAP access.

The user signs in with Google (existing flow), then goes to Settings to add more accounts by entering IMAP credentials.

## Architecture

```
Sign in: Google OAuth (existing, unchanged)
         ↓
Primary inbox: Gmail API (existing, unchanged)
         ↓
Additional accounts: IMAP connections
  - Outlook: imap-mail.outlook.com:993
  - iCloud: imap.mail.me.com:993
  - Yahoo: imap.mail.yahoo.com:993
  - Work/school: whatever their IT provides
  - Any IMAP server
         ↓
All threads → same Thread table, same buckets, same classification
```

---

## Data Model Changes

### Add IMAP account model
```prisma
model ImapAccount {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  label         String    // user-friendly name: "Work Email", "iCloud", "Outlook"
  email         String
  imapHost      String
  imapPort      Int       @default(993)
  imapTls       Boolean   @default(true)
  password      String    // app-specific password or regular password (stored encrypted)
  connected     Boolean   @default(false)
  lastSyncAt    DateTime?
  lastError     String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([userId, email])
}
```

Add the relation to User:
```prisma
model User {
  // ... existing fields stay the same
  imapAccounts  ImapAccount[]
}
```

### Add provider field to Thread
```prisma
model Thread {
  // ... all existing fields stay the same
  provider      String    @default("gmail")    // "gmail" or the ImapAccount id
  providerLabel String    @default("Gmail")    // display name: "Gmail", "iCloud", "Work"
}
```

Run `npx prisma db push` after updating.

---

## IMAP Service: src/lib/imap-service.ts

Install the IMAP library:
```bash
npm install imapflow
npm install -D @types/imapflow
```

```typescript
import { ImapFlow } from "imapflow";

interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  email: string;
  password: string;
}

interface ImapThreadSummary {
  uid: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  date: Date;
}

// Test connection — used when user adds a new account
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
  } catch (err: any) {
    return { success: false, error: err.message || "Connection failed" };
  }
}

// Fetch recent messages from INBOX
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
    const totalMessages = client.mailbox?.exists || 0;
    
    if (totalMessages === 0) return [];

    // Fetch the most recent N messages by sequence number
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
        snippet: "", // IMAP envelopes don't include body preview
        date: msg.envelope?.date || new Date(),
      });
    }

    return messages.reverse(); // newest first
  } finally {
    lock.release();
    await client.logout();
  }
}
```

---

## Password Encryption: src/lib/crypto.ts

IMAP passwords should not be stored in plain text. Use simple AES-256 encryption with NEXTAUTH_SECRET as the key:

```typescript
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || "fallback-dev-key-change-me";
  return crypto.scryptSync(secret, "inbox-concierge-salt", 32);
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decrypt(data: string): string {
  const key = getKey();
  const [ivHex, tagHex, encrypted] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

Use `encrypt()` when saving passwords, `decrypt()` when reading them for IMAP connections.

---

## API Routes

### POST /api/imap/test
Test an IMAP connection before saving.
```
Body: { host, port, email, password, tls? }
Response: { success: boolean, error?: string, mailboxCount?: number }
```

### POST /api/imap/accounts
Add a new IMAP account.
```
Body: { label, email, imapHost, imapPort, password, imapTls? }
Steps:
  1. Test the connection first
  2. If successful, encrypt password and save to ImapAccount
  3. Set connected: true
  4. Return the account (without password)
Response: { id, label, email, imapHost, connected }
```

### GET /api/imap/accounts
List all IMAP accounts for the current user.
```
Response: [{ id, label, email, imapHost, imapPort, connected, lastSyncAt, lastError }]
Never include the password in the response.
```

### DELETE /api/imap/accounts/[id]
Disconnect and delete an IMAP account.
```
Steps:
  1. Delete the ImapAccount
  2. Optionally: delete or orphan threads from this account
     (for MVP: just delete the account, threads stay with provider = accountId)
Response: { deleted: true }
```

### POST /api/imap/sync/[id]
Sync a specific IMAP account.
```
Steps:
  1. Load the ImapAccount, decrypt password
  2. Call fetchImapMessages
  3. Upsert threads with provider = account.id, providerLabel = account.label
  4. Update lastSyncAt
  5. If error, update lastError
Response: { synced: number }
```

### POST /api/sync (unified — update existing)
Update the existing sync route to also sync all IMAP accounts:
```
Steps:
  1. Sync Gmail (existing)
  2. For each connected ImapAccount: sync IMAP
  3. Return: { total: number, gmail: number, imap: { [label]: number } }
```

---

## Settings Page: Email Accounts Section

Add a "Connected Email Accounts" section at the top of the Settings page (above AI Provider).

### Layout

**Gmail account (always shown):**
- Gmail icon + user's Gmail address
- "Primary account" badge
- Last synced time
- This can't be disconnected (it's the auth account)

**IMAP accounts list:**
- Each shows: icon, label, email, last synced, status (connected/error)
- If lastError is set, show it in red
- "Remove" button on each

**"Add Email Account" button** → opens a modal or inline form

### Add Account Modal/Form

**Quick presets** (buttons that pre-fill IMAP settings):
- **Outlook / Hotmail** → host: `imap-mail.outlook.com`, port: `993`, tls: true
  - Note: "Use your Outlook password, or an app password if you have 2FA enabled"
- **iCloud** → host: `imap.mail.me.com`, port: `993`, tls: true
  - Note: "Requires an app-specific password. [Generate one here](https://account.apple.com) → Sign-In and Security → App-Specific Passwords"
- **Yahoo** → host: `imap.mail.yahoo.com`, port: `993`, tls: true
  - Note: "Requires an app password. Generate one in Yahoo Account Security settings."
- **Other / Custom** → all fields blank

**Form fields (shown after picking a preset or "Other"):**
- Label: text input, pre-filled from preset ("Outlook", "iCloud", etc.) but editable
- Email: text input
- Password: password input with show/hide toggle
- IMAP Host: text input, pre-filled from preset
- IMAP Port: number input, default 993
- Use TLS: checkbox, default checked

**Buttons:**
- "Test Connection" → calls POST /api/imap/test → shows success/failure inline
- "Add Account" → calls POST /api/imap/accounts → adds to list, closes modal

**Helper text for common issues:**
- "Connection refused" → "Check that the IMAP host and port are correct"
- "Authentication failed" → "Check your email and password. If you have 2FA enabled, you need an app-specific password."
- "Certificate error" → "Try toggling TLS off, or check with your email provider"

---

## Sidebar Updates

### Sync button
"Sync Inbox" now syncs Gmail + all IMAP accounts. Show progress:
"Syncing Gmail... Syncing iCloud... Syncing Work Email... Done (342 threads)"

### Source filter (below buckets)
Add a collapsible "Sources" section at the bottom of the sidebar:
- "All Sources" (default, selected)
- "Gmail" + count
- Each IMAP account label + count
Clicking one filters the thread list. This uses the `provider` field on Thread.

---

## Thread List Updates

### Provider indicator
On each thread row, show a small label or icon indicating the source:
- "Gmail" in a subtle colored tag
- The IMAP account label in a subtle colored tag
- Use the providerLabel field

### Filter support
GET /api/threads should accept a `provider` query param to filter by source.

---

## Common IMAP Presets Reference

For the preset buttons, use these settings:

| Provider | IMAP Host | Port | TLS | Password Notes |
|----------|-----------|------|-----|----------------|
| Outlook/Hotmail/Live | imap-mail.outlook.com | 993 | Yes | Regular password or app password with 2FA |
| iCloud | imap.mail.me.com | 993 | Yes | Requires app-specific password (2FA required) |
| Yahoo | imap.mail.yahoo.com | 993 | Yes | Requires app password |
| AOL | imap.aol.com | 993 | Yes | Requires app password |
| Fastmail | imap.fastmail.com | 993 | Yes | App password recommended |
| ProtonMail | 127.0.0.1 | 1143 | No | Requires ProtonMail Bridge running locally |
| Zoho | imap.zoho.com | 993 | Yes | App-specific password if 2FA enabled |
| GMX | imap.gmx.com | 993 | Yes | Regular password |
| Custom | (user fills in) | 993 | Yes | Depends on provider |

---

## Build Order

1. Update Prisma schema (ImapAccount + Thread.provider + Thread.providerLabel), run db push
2. Build crypto.ts (encrypt/decrypt)
3. Build imap-service.ts (testConnection + fetchMessages)
4. Build IMAP API routes: test, accounts CRUD, sync
5. Update unified sync route to include IMAP accounts
6. Build the Settings page Email Accounts section with presets and add form
7. Update sidebar: sync all sources, add source filter
8. Update thread list: provider labels, provider filter query param
9. Update GET /api/threads to support provider filter
10. Polish: loading states, error messages, preset UX, connection status indicators

---

## Verification

- npm run dev starts without errors
- Existing Gmail flow is completely unchanged (sign in, sync, classify all work)

IMAP accounts:
- Settings page shows Gmail as primary account
- "Add Email Account" button opens the form
- Preset buttons pre-fill correct IMAP settings for Outlook, iCloud, Yahoo
- "Other" preset leaves fields blank for custom servers
- "Test Connection" correctly reports success/failure
- Adding an account saves it and shows it in the list
- Passwords are encrypted in the database (check with Prisma Studio)
- Passwords are never returned in API responses
- Syncing an IMAP account pulls threads into the thread list
- IMAP threads show provider labels ("iCloud", "Work Email", etc.)
- Removing an account deletes it from the list

Unified:
- "Sync Inbox" syncs Gmail + all IMAP accounts
- Source filter in sidebar shows all sources with counts
- Clicking a source filters the thread list
- Classification works on IMAP threads identically to Gmail threads
- Bucket counts include threads from all sources

Edge cases:
- Adding an account with wrong credentials shows a clear error
- Account with expired password shows error status in the list
- Syncing with a down IMAP server doesn't crash the whole sync (fails gracefully, syncs other accounts)

- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>IMAP_DONE</promise>
