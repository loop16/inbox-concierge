# Inbox Concierge — Build Spec for Claude Code (Ralph Wiggum Loop)

## What This Is
A local AI-powered email triage app. User signs in with Google, loads recent Gmail threads, and sees them auto-bucketed by an LLM classification pipeline. User can create custom buckets and reclassify on demand.

This is a local project. No deployment. No hosted DB. SQLite + localhost.

---

## Tech Stack
- **Frontend:** Next.js 14 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes (TypeScript)
- **Auth:** NextAuth.js with Google OAuth provider (Gmail read-only scope)
- **Database:** SQLite via Prisma ORM (file-based, zero setup)
- **LLM:** Claude via the `@anthropic-ai/claude-code` TypeScript Agent SDK (uses your Max subscription — no API key or credits needed)
- **State:** React Query for server state, zustand for client state

---

## How the LLM Classification Works (Max Subscription)

This app does NOT use the Anthropic API directly. Instead, it uses the Claude Agent SDK for TypeScript, which routes through your local Claude Code installation and your Max subscription.

### Setup
1. Make sure Claude Code is installed: `npm install -g @anthropic-ai/claude-code`
2. Make sure you're logged in with your Max subscription: run `claude` in terminal and authenticate
3. Install the SDK in the project: `npm install @anthropic-ai/claude-code`

### Usage in the classification API route
```typescript
import { query, ClaudeAgentOptions } from "@anthropic-ai/claude-code";

async function classifyThreads(threads: ThreadSummary[], buckets: BucketDef[]): Promise<Classification[]> {
  const prompt = `You are an email classifier. Given these email threads and bucket definitions, assign each thread to exactly one bucket.

Buckets:
${JSON.stringify(buckets)}

Threads:
${JSON.stringify(threads)}

Respond with JSON only. No markdown. No backticks. Format:
[
  { "threadId": "...", "bucket": "bucket name", "confidence": 0.0-1.0, "reason": "short reason" }
]`;

  const options: ClaudeAgentOptions = {
    maxTurns: 1,
    systemPrompt: "You are an email classification assistant. Always respond with valid JSON only.",
  };

  let result = "";
  for await (const message of query({ prompt, options })) {
    if (message.type === "assistant" && message.content) {
      for (const block of message.content) {
        if (block.type === "text") {
          result += block.text;
        }
      }
    }
  }

  return JSON.parse(result.trim());
}
```

### Important notes
- The Agent SDK uses your Max subscription, NOT API credits
- Make sure `ANTHROPIC_API_KEY` is NOT set in your environment, or it will use API credits instead
- Each classification batch should be 10-15 threads to keep responses fast and parseable
- If you hit rate limits, add a small delay between batches

### Fallback
If the Agent SDK gives you trouble, you can fall back to the direct API with an API key:
```
ANTHROPIC_API_KEY=sk-ant-...
```
And use the standard `@anthropic-ai/sdk` package with `client.messages.create()`. This will use API credits, not your Max sub.

---

## Google Cloud Setup (Step by Step)

### 1. Create a Google Cloud Project
1. Go to https://console.cloud.google.com/
2. Click the project dropdown at the top → "New Project"
3. Name it something like `inbox-concierge`
4. Click "Create"
5. Make sure the new project is selected in the dropdown

### 2. Enable the Gmail API
1. Go to https://console.cloud.google.com/apis/library
2. Search for "Gmail API"
3. Click on it → click "Enable"

### 3. Configure the OAuth Consent Screen
1. Go to https://console.cloud.google.com/apis/credentials/consent
2. Select "External" user type → click "Create"
3. Fill in:
   - App name: `Inbox Concierge`
   - User support email: your email
   - Developer contact: your email
4. Click "Save and Continue"
5. On the "Scopes" screen, click "Add or Remove Scopes"
6. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
7. Click "Update" → "Save and Continue"
8. On "Test users", add your own Gmail address
9. Click "Save and Continue" → "Back to Dashboard"

**Important:** While the app is in "Testing" mode, only the test users you add can sign in. This is fine for a local project.

### 4. Create OAuth Credentials
1. Go to https://console.cloud.google.com/apis/credentials
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: "Web application"
4. Name: `Inbox Concierge Local`
5. Authorized JavaScript origins: `http://localhost:3000`
6. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
7. Click "Create"
8. Copy the **Client ID** and **Client Secret**

### 5. Add to your `.env.local`
```
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
```

Generate the NEXTAUTH_SECRET with:
```bash
openssl rand -base64 32
```

---

## Data Model (Prisma — SQLite)

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  accessToken   String?
  refreshToken  String?
  threads       Thread[]
  buckets       Bucket[]
  createdAt     DateTime  @default(now())
}

model Thread {
  id            String    @id @default(cuid())
  gmailThreadId String
  subject       String
  sender        String
  senderEmail   String
  snippet       String
  date          DateTime
  labelIds      String    @default("[]")  // JSON string (SQLite has no array type)
  bucketId      String?
  bucket        Bucket?   @relation(fields: [bucketId], references: [id])
  confidence    Float?
  reason        String?
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  createdAt     DateTime  @default(now())

  @@unique([userId, gmailThreadId])
}

model Bucket {
  id            String    @id @default(cuid())
  name          String
  description   String?
  examples      String?
  isDefault     Boolean   @default(false)
  sortOrder     Int       @default(0)
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  threads       Thread[]
  createdAt     DateTime  @default(now())

  @@unique([userId, name])
}
```

---

## Default Buckets (seed on first login)
1. Action Required
2. Important
3. Can Wait
4. Finance / Receipts
5. Newsletters
6. Recruiting / Job
7. Personal
8. Auto-Archive

---

## Core API Routes

### `POST /api/gmail/sync`
- Fetch up to 200 most recent threads from Gmail API using user's access token
- For each thread: extract threadId, subject, sender, senderEmail, snippet, date, labels
- Upsert into Thread table
- Return `{ synced: number }`

### `POST /api/classify`
- Load all unclassified threads (or all if `reclassify=true` query param)
- Load user's bucket definitions
- Batch threads in groups of 10-15
- For each batch, call Claude via Agent SDK (see classification section above)
- Update each thread with bucketId, confidence, reason
- Return `{ classified: number }`

### `GET /api/threads`
- Query params: `bucketId` (optional filter)
- Return threads with bucket info, ordered by date desc

### `GET /api/buckets`
- Return all buckets for user with thread counts

### `POST /api/buckets`
- Create a new custom bucket
- Body: `{ name, description?, examples? }`

### `PUT /api/buckets/:id`
- Update bucket name/description/examples

### `DELETE /api/buckets/:id`
- Delete bucket, set its threads' bucketId to null

---

## Frontend Pages

### `/` — Landing / Sign In
- Simple hero: "Triage your inbox with AI"
- Google sign-in button
- Redirect to `/inbox` after auth

### `/inbox` — Main App (protected)
- **Layout:** sidebar + main content
- **Sidebar:**
  - List of buckets with thread counts as badges
  - Click bucket to filter
  - "All" option at top
  - "New Bucket" button at bottom
  - "Sync Inbox" button
  - "Reclassify" button
- **Main content:**
  - Thread list: each row shows subject, sender, date, bucket tag, confidence dot
  - Click thread → expand to show snippet + classification reason
  - No need to show full email body in MVP
- **Top bar:**
  - User email + avatar
  - Sign out

### New Bucket Modal
- Fields: name (required), description, examples (textarea)
- On save: create bucket, then auto-reclassify

---

## Classification Pipeline

### Step 1: Rule-based pre-classification (before LLM)
- Sender domain matches known newsletter services (substack.com, mailchimp, convertkit, etc.) → Newsletters
- Subject contains "receipt", "invoice", "payment", "order confirmation" → Finance / Receipts
- Subject contains "job", "opportunity", "recruiter", "hiring", "role" → Recruiting / Job
- Gmail label is CATEGORY_PROMOTIONS → Newsletters
- Gmail label is CATEGORY_SOCIAL → Personal

### Step 2: LLM classification via Agent SDK
- Everything not caught by rules goes to Claude
- Batch 10-15 threads per call
- Parse JSON response, handle malformed responses (retry once, then mark as unclassified)

### Step 3: User overrides (stretch)
- If user manually reassigns a thread, persist it
- Don't overwrite on reclassify

---

## Environment Variables (`.env.local`)

```
GOOGLE_CLIENT_ID=              # from Google Cloud Console
GOOGLE_CLIENT_SECRET=          # from Google Cloud Console
NEXTAUTH_SECRET=               # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
```

Note: No `ANTHROPIC_API_KEY` needed. The Agent SDK uses your Max subscription via Claude Code CLI auth.

---

## Build Order (for the Ralph Wiggum loop)

Feed these to Claude Code one at a time. Each step should be fully working before moving on.

1. **Scaffold:** `npx create-next-app@latest inbox-concierge --typescript --tailwind --app --src-dir`

2. **Install deps:** `npm install next-auth @prisma/client @anthropic-ai/claude-code zustand @tanstack/react-query`; `npx prisma init`

3. **Database:** Set up Prisma schema (above), configure SQLite, run `npx prisma db push`, create seed script for default buckets

4. **Auth:** Set up NextAuth with Google provider, configure scopes for gmail.readonly, store access/refresh tokens in DB, get sign-in/sign-out working at `/`

5. **Gmail sync:** Build `POST /api/gmail/sync` — use user's access token to call Gmail threads.list, extract metadata, upsert to DB. Test: after login, hit sync, verify threads in DB.

6. **Thread list UI:** Build `/inbox` page showing threads from DB in a clean list. Subject, sender, date, snippet. No bucket stuff yet.

7. **Bucket sidebar:** Show buckets with counts in sidebar, filter threads on click, "All" option at top.

8. **Classification engine:** Build `POST /api/classify` with:
   - Rule-based pre-classification
   - Agent SDK calls for remaining threads
   - Parse and persist results
   Test: hit classify, verify threads get bucket assignments.

9. **Wire it up:** Connect Reclassify button, show loading state with progress, display bucket tags and confidence on thread rows, show classification reason on expand.

10. **Custom buckets:** Create/edit/delete bucket modal. On new bucket creation, auto-trigger reclassify.

11. **Polish:** Loading states, error handling, empty states, responsive sidebar, nice color-coded bucket tags.

---

## Key Implementation Notes

- **Gmail API pagination:** Use `threads.list` with `maxResults=200`. For each thread, a single `threads.get` call gets subject/sender/snippet. Batch these with `Promise.all` in groups of 10 to avoid rate limits.
- **Token refresh:** Configure NextAuth to persist the refresh token and handle token rotation. Request `access_type: "offline"` and `prompt: "consent"` in the Google provider config.
- **Agent SDK auth:** Make sure `ANTHROPIC_API_KEY` is NOT in your env. The SDK should auto-detect your Claude Code login. If it doesn't find auth, it'll error — run `claude` in terminal first to make sure you're logged in.
- **SQLite arrays:** SQLite doesn't support arrays. Store `labelIds` as a JSON string and parse in TypeScript.
- **Classification batching:** 10-15 threads per batch. Run batches sequentially (not parallel) to avoid Max subscription rate limits. Add a 1-2 second delay between batches.
- **Error handling:** If Claude returns malformed JSON, strip any markdown backticks, try parsing again. If still broken, retry the batch once. If still broken, mark those threads as unclassified.

---

## What Success Looks Like
- Sign in → sync → see 200 threads bucketed in under 60 seconds
- Buckets feel useful on first pass without any customization
- Creating a "Trading Research" bucket and reclassifying puts the right threads there
- UI is clean, fast, and obvious
- No API credits used — everything runs through your Max subscription
