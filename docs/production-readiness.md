# Production Readiness: Hosted Multi-User App with Ephemeral Email Data

Read SPEC.md for full project context.

## Overview
Transform Inbox Concierge from a local SQLite app into a hosted multi-user app that:
- Uses Postgres instead of SQLite (for multi-user concurrency)
- Deletes email thread data on logout (privacy-first)
- Keeps user settings, buckets, sender rules, and IMAP accounts across sessions
- Uses a single server-side OpenAI API key (OPENAI_API_KEY env var) for all users
- If the key has no credits or fails, classification gracefully falls back to rules-only (no crash)
- Users do NOT need their own API key — the app provides AI classification as a feature
- Deployable to Vercel + a managed Postgres provider (Neon, Supabase, or Vercel Postgres)

## Architecture

```
Vercel (Next.js)
  ├── Frontend (React, Tailwind, shadcn)
  ├── API Routes (serverless functions)
  └── NextAuth (Google OAuth)
          ↓
Managed Postgres (Neon or Vercel Postgres)
  ├── Users (persistent)
  ├── Buckets (persistent) 
  ├── SenderRules (persistent)
  ├── ImapAccounts (persistent, passwords encrypted)
  └── Threads (EPHEMERAL — deleted on logout)
          ↓
OpenAI API (single server-side key in OPENAI_API_KEY env var)
  └── If key fails/empty balance → rules-only classification (no crash)
```

---

## Step 1: Switch from SQLite to Postgres

### Update Prisma schema datasource
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Update field types that were SQLite-specific
- `labelIds String @default("[]")` → keep as String (JSON), this works fine in Postgres too
- No other changes needed — Prisma abstracts the differences

### Update .env.local
```
DATABASE_URL=postgresql://user:password@host:5432/inbox_concierge
```

### For local development
Option A: Use a free Neon database (easiest):
1. Go to https://neon.tech → create a free project
2. Copy the connection string
3. Paste into .env.local as DATABASE_URL

Option B: Run Postgres locally via Docker:
```bash
docker run --name inbox-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=inbox_concierge -p 5432:5432 -d postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inbox_concierge
```

### Run migration
```bash
npx prisma db push
npx prisma db seed  # re-seed default buckets
```

---

## Step 2: Ephemeral Thread Data — Delete on Logout

### Create a logout cleanup API route: POST /api/auth/cleanup

```typescript
// This runs BEFORE the session is destroyed
// Steps:
//   1. Get the current user from the session
//   2. Delete all Threads for this user
//   3. Do NOT delete: User, Buckets, SenderRules, ImapAccounts, AIProviderConfig
//   4. Return { deleted: number }
```

### Wire cleanup into the sign-out flow

In the frontend, replace the default NextAuth `signOut()` with a custom flow:

```typescript
async function handleSignOut() {
  // 1. Delete ephemeral data
  await fetch("/api/auth/cleanup", { method: "POST" });
  // 2. Then sign out
  await signOut({ callbackUrl: "/" });
}
```

Use this custom `handleSignOut` everywhere the sign-out button appears.

### Add a session expiry cleanup (belt and suspenders)

Create a scheduled cleanup that deletes threads for sessions that expired without a clean logout:

Option A (simple): In the NextAuth session callback, check if any user has threads older than 24 hours with no active session. Clean them up.

Option B (better for production): Add a `lastActiveAt` timestamp to the User model. Update it on every API call. Run a cleanup job (via Vercel Cron) that deletes threads for users who haven't been active in 24 hours.

```prisma
model User {
  // ... existing fields
  lastActiveAt  DateTime?
}
```

Create a cron endpoint: GET /api/cron/cleanup-threads
```typescript
// Delete all threads for users where lastActiveAt < 24 hours ago
// This catches abandoned sessions
// Protect with a CRON_SECRET env var
```

Add to vercel.json:
```json
{
  "crons": [{
    "path": "/api/cron/cleanup-threads",
    "schedule": "0 */6 * * *"
  }]
}
```

### Show the user what's happening

On the sign-in page or first load, show a subtle privacy notice:
"Your email content is processed in-session only and automatically deleted when you sign out. Your custom buckets and rules are saved for next time."

On the sign-out button, change text to "Sign Out (clears email data)" or show a small tooltip.

---

## Step 3: Server-Side OpenAI Key with Graceful Degradation

### How it works
- A single OPENAI_API_KEY is set as an env var on the server (Vercel)
- All users share this key for classification
- The classify route uses this key directly — no per-user key storage needed
- If the key has no credits, is invalid, or OpenAI returns an error, classification silently falls back to rules-only

### Update the LLM client (src/lib/llm-client.ts)

Simplify to read from the server env var only:

```typescript
import OpenAI from "openai";

let _client: OpenAI | null = null;
let _available: boolean | null = null;

export function getLLMClient(): OpenAI | null {
  // If we already know the key is missing, don't retry
  if (_available === false) return null;
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    _available = false;
    console.warn("[LLM] No OPENAI_API_KEY set. Using rules-only classification.");
    return null;
  }

  _client = new OpenAI({ apiKey });
  _available = true;
  return _client;
}

export function getLLMModel(): string {
  return process.env.OPENAI_MODEL || "gpt-5-mini";
}
```

### Update the classify route error handling

In the classify API route, wrap the LLM classification in robust error handling:

```typescript
try {
  const results = await classifyWithLLM(client, model, batch, buckets);
  llmClassified += results.length;
} catch (error: any) {
  const msg = error?.message || "";
  
  if (msg.includes("insufficient_quota") || msg.includes("billing")) {
    // Out of credits — fall back to rules for remaining batches
    console.warn("[Classify] OpenAI credits exhausted. Falling back to rules-only.");
    // Mark remaining threads as rules-only, stop calling the API
    break;
  }
  
  if (msg.includes("invalid_api_key") || msg.includes("401")) {
    console.error("[Classify] Invalid API key. Falling back to rules-only.");
    break;
  }
  
  // Transient error — log and continue with next batch
  console.error("[Classify] LLM error on batch:", msg);
  failedCount += batch.length;
}
```

### Update the classify response to include AI status

```typescript
return Response.json({
  classified: total,
  senderRules: senderRuleCount,
  builtInRules: builtInRuleCount,
  llmBased: llmClassified,
  failed: failedCount,
  aiAvailable: llmAvailable,  // true/false — was the LLM used at all?
  aiError: aiErrorMessage,     // null or "Credits exhausted" / "Invalid key" etc.
});
```

### Update the UI to show AI status

In the sidebar, below the Classify button, show:
- If AI worked: "AI: gpt-5-mini ✓" (green)
- If AI failed gracefully: "AI: unavailable — using rules only" (amber)
- The toast after classification should say: "Classified 200 threads (45 by rules, 148 by AI, 7 failed)" or "Classified 200 threads (rules only — AI unavailable)"

### Remove per-user AI settings complexity

Since the API key is server-side:
- Remove the AIProviderConfig model from Prisma (or leave it but ignore it)
- Remove the API key input from the Settings page
- Remove the AI Provider section from Settings entirely — users don't need to configure anything
- Remove any CLIProxyAPI/proxy UI
- The Settings page now only has: Email Accounts + Learned Rules (much simpler)

### What happens when credits run out
1. User clicks Classify
2. LLM calls fail with `insufficient_quota`
3. The classify route catches this, stops calling the API, classifies remaining threads with rules only
4. Toast shows: "Classified 200 threads (rules only — AI temporarily unavailable)"
5. Sender rules the user has built up still work perfectly (they're free, no API needed)
6. When you add more credits, AI classification resumes automatically on next run
7. No crash, no error page, no broken state

---

## Step 4: Production Environment Variables

### Required env vars for deployment
```
# Database
DATABASE_URL=postgresql://...

# Auth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://your-app.vercel.app

# AI Classification (your OpenAI key — shared by all users)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini

# Encryption (for IMAP passwords)
# Uses NEXTAUTH_SECRET by default, but can be overridden
ENCRYPTION_KEY=

# Cron security
CRON_SECRET=
```

### Update Google OAuth for production
You'll need to update the Google Cloud Console:
1. Add the production URL to authorized origins: `https://your-app.vercel.app`
2. Add the production callback: `https://your-app.vercel.app/api/auth/callback/google`
3. You may need to publish the OAuth consent screen (move from "Testing" to "Production")
4. Since you request `gmail.readonly` (a restricted scope), Google will require app verification — this can take a few days

---

## Step 5: Rate Limiting & Abuse Prevention

### Add basic rate limiting
Since users bring their own API keys, the main abuse vector is hitting your server (not OpenAI). Add simple rate limits:

```typescript
// src/lib/rate-limit.ts
// Use a simple in-memory rate limiter (or Vercel KV for production)
// Limits:
//   - Sync: 10 requests per hour per user
//   - Classify: 5 requests per hour per user
//   - General API: 100 requests per minute per user
```

For MVP, use in-memory rate limiting with a Map. For production scale, use Vercel KV or Upstash Redis.

### Limit thread storage per user
Cap the number of threads stored per user to prevent abuse:
- Max 500 threads per user at any time
- When syncing, if count would exceed 500, delete oldest threads first
- This keeps the ephemeral data small

---

## Step 6: Landing Page for Public App

### Update the landing page (src/app/page.tsx)
The current page is a simple sign-in button. For a public app, make it more compelling:

- Hero section: "AI-Powered Inbox Triage" with a subtitle
- Three feature highlights:
  - "Connect Gmail + any IMAP email"
  - "AI classifies your inbox into smart buckets"  
  - "Your emails are never stored — deleted on sign out"
- Privacy callout: "We process your email in-session only. Thread data is automatically deleted when you sign out. Your custom rules and buckets persist."
- "Sign in with Google" button (prominent)
- Footer with: "Bring your own OpenAI API key" note

Keep it clean and minimal — one page, no scroll needed.

---

## Step 7: Deployment Configuration

### vercel.json
```json
{
  "crons": [{
    "path": "/api/cron/cleanup-threads",
    "schedule": "0 */6 * * *"
  }]
}
```

### next.config.js updates
Make sure the config is production-ready:
- No hardcoded localhost URLs
- Environment variables are properly referenced
- Image domains are configured if using any external images

### Prisma on Vercel
Add a postinstall script to package.json:
```json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

This ensures Prisma Client is generated during Vercel builds.

---

## Step 8: Security Hardening

### CSRF protection
NextAuth handles this for auth routes. For custom API routes, verify the session on every request.

### Input validation
- Validate all user inputs (bucket names, IMAP hosts, email addresses)
- Sanitize strings before storing
- Validate that bucket names aren't excessively long (max 50 chars)

### API key security
- Never log API keys
- Never return decrypted API keys in responses
- Use masked display: `sk-proj-...a4Xk`

### IMAP password security
- Same encryption as API keys
- Never return in API responses
- Never log

### Session validation
Every API route should:
1. Check for valid NextAuth session
2. Only return data belonging to the authenticated user
3. Verify the userId in the URL matches the session userId

---

## Build Order

1. Switch Prisma to Postgres, update schema, test with Neon or local Docker
2. Run migrations, verify all existing features work with Postgres
3. Build POST /api/auth/cleanup route
4. Wire cleanup into sign-out flow
5. Add lastActiveAt to User, build cron cleanup endpoint
6. Simplify LLM client to use server-side OPENAI_API_KEY only
7. Add graceful degradation to classify route (catch quota/key errors, fall back to rules)
8. Remove per-user AI settings from Settings page (remove AIProviderConfig if present, remove API key input, remove proxy UI)
9. Update sidebar AI status indicator
10. Add rate limiting middleware
11. Add thread storage cap (500 per user)
12. Update landing page for public app
13. Add vercel.json, update next.config.js
14. Add postinstall script for Prisma
15. Security hardening pass
16. Test full flow: sign in → sync → classify → sign out → verify threads deleted → sign back in → buckets/rules still there

---

## Verification

Database:
- App works with Postgres (not SQLite)
- npx prisma db push runs clean against Postgres
- All existing features work after the migration

Ephemeral data:
- Sign in → sync → see threads
- Sign out → threads are deleted from DB (check with Prisma Studio or psql)
- Sign back in → no threads (inbox is empty until re-sync)
- Buckets, sender rules, IMAP accounts all persist across logout/login
- Cron cleanup endpoint works (deletes threads for inactive users)

AI classification:
- With valid OPENAI_API_KEY: classification uses the LLM, sidebar shows "AI: gpt-5-mini ✓"
- With invalid/empty OPENAI_API_KEY: classification falls back to rules-only, no crash, sidebar shows "AI: unavailable"
- With exhausted credits: first few batches may work, then gracefully falls back mid-run, toast explains what happened
- No per-user AI settings page exists (removed)
- No API key input anywhere in the UI (it's server-side only)

Rate limiting:
- Hitting sync > 10 times in an hour returns 429
- Hitting classify > 5 times in an hour returns 429

Landing page:
- Looks professional, communicates privacy story
- Sign-in works from the landing page

Production readiness:
- No hardcoded localhost URLs
- All secrets in env vars
- vercel.json has cron config
- postinstall generates Prisma client
- npx tsc --noEmit passes
- npm run lint passes
- npm run build succeeds

When all verifications pass, output <promise>PRODUCTION_DONE</promise>
