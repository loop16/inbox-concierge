# Inbox Concierge

AI-powered email triage. Connect Gmail via OAuth or any IMAP provider (Outlook, iCloud, Yahoo, etc.), and let AI + a 5-layer rule engine classify your inbox into smart buckets.

## Features

- **Gmail + IMAP** — Gmail via OAuth, plus Outlook, iCloud, Yahoo, Fastmail, ProtonMail, Zoho, AOL, and any IMAP server
- **AI Classification** — Google Gemini (2.5 Flash) with parallel batch processing and automatic retry on failures
- **Smart Rules Engine** — 5-layer rule engine (sender rules, auto-detect, labels, keywords, custom matching) handles 60-80% of emails before AI kicks in
- **Progressive Classification** — Results stream to the UI as each batch completes via NDJSON streaming, no waiting for all batches to finish
- **Receipt Detection** — Dedicated receipt sender domain list (Lyft, Uber, Amazon, Stripe, PayPal, airlines, etc.) auto-classifies financial emails
- **AI Top 5** — On-demand scan that picks the 5 emails most needing your attention, scored by urgency, actionability, risk, and sender type
- **Email Summarization** — AI-generated summaries from the full email body (not just the snippet), with action item extraction
- **Smart Onboarding** — AI analyzes your inbox and suggests custom buckets alongside defaults, then classifies everything with a cinematic loading animation
- **Drag-and-Drop** — Drag emails between buckets to reclassify and automatically learn sender rules
- **Privacy-First** — Email thread data is deleted on sign out. Buckets and rules persist.
- **Heatmap View** — Visualize your inbox patterns over time
- **Cinematic Loader** — Canvas-based dot morphing animation between shapes (ring, envelope, horse, grid, bars, circle) during classification

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: PostgreSQL (Neon) via Prisma 7
- **Auth**: NextAuth with Google OAuth
- **AI**: Google Gemini API (gemini-2.5-flash) via OpenAI-compatible endpoint
- **Email**: ImapFlow for IMAP, Gmail API for Google
- **Frontend**: React 19, Tailwind CSS v4, Zustand, React Query
- **Deployment**: Vercel

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) database (free tier works)
- Google Cloud project with OAuth credentials (Gmail read-only scope)
- Google AI API key ([Google AI Studio](https://aistudio.google.com/apikey))

## Setup

### 1. Clone and install

```bash
git clone git@github.com:loop16/inbox-concierge.git
cd inbox-concierge
npm install
```

### 2. Create `.env.local`

```env
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# NextAuth
NEXTAUTH_SECRET=generate-a-random-secret
NEXTAUTH_URL=http://localhost:3000

# Google Gemini AI
GOOGLE_AI_API_KEY=your-gemini-api-key

# Optional: Override model names
# LLM_MODEL=gemini-2.5-flash              # Fast model for bulk classification
# LLM_SMART_MODEL=gemini-2.5-flash        # Smart model for reasoning tasks

# Optional: Use OpenAI instead of Gemini
# OPENAI_API_KEY=sk-proj-...
# OPENAI_MODEL=gpt-4o-mini

# IMAP encryption key (for storing IMAP passwords)
ENCRYPTION_KEY=generate-a-32-byte-hex-string

# Cron security (for cleanup job)
CRON_SECRET=any-random-string
```

#### Generate secrets

```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY (32 bytes hex)
openssl rand -hex 32
```

### 3. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Gmail API**
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized JavaScript origins: `http://localhost:3000`
7. Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
8. Copy the Client ID and Client Secret into `.env.local`

> The app requests `gmail.readonly` scope — it can only read emails, never send or modify.

### 4. Set up the database

1. Go to [neon.tech](https://neon.tech) and create a free project
2. Copy the connection string (with pooler) into `DATABASE_URL`
3. Push the schema:

```bash
npx prisma db push
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Google, and your inbox will be synced and classified.

## How It Works

### Classification Flow

1. **Sync** pulls emails from Gmail API or IMAP
2. **Classify** runs a 5-layer rule engine first:
   - **Sender rules** (95% confidence) — learned from your manual drag-and-drop assignments
   - **Auto-detect** (92-88%) — receipt sender domains, noreply addresses, bulk senders, notification domains
   - **Gmail labels** (85%) — promotions category
   - **Keywords** (85-78%) — finance, recruiting, action-required patterns
   - **Custom matching** (70%) — your bucket descriptions and examples
3. Remaining threads go to **Gemini AI in parallel batches of 10**
4. Results stream back progressively — the UI updates as each batch completes
5. Failed batches automatically retry up to 2 times
6. If the primary model returns 404, a fallback chain tries `gemini-2.0-flash-001` then `gemini-2.0-flash`

### AI Models

| Task | Model | Purpose |
|------|-------|---------|
| Bulk classification | `gemini-2.5-flash` | Email-to-bucket mapping in parallel batches |
| Bucket suggestions | `gemini-2.5-flash` | Analyze inbox patterns, suggest new categories |
| Email summarization | `gemini-2.5-flash` | Full-body summaries with action items |
| Top 5 ranking | `gemini-2.5-flash` | Priority ranking with dimensional scoring |

All models use Google's OpenAI-compatible endpoint, so the OpenAI SDK works with Gemini out of the box. The app auto-detects which provider is configured.

### Default Buckets

- Action Required
- Important
- Can Wait
- Finance / Receipts
- Newsletters
- Recruiting / Job
- Personal
- Auto-Archive

### Receipt / Finance Detection

A dedicated set of receipt sender domains (Lyft, Uber, DoorDash, Amazon, Stripe, PayPal, airlines, etc.) auto-classifies as "Finance / Receipts" without needing AI. This runs in the auto-detect layer before AI classification.

### Classification Prompt

The AI prompt includes strict rules to prevent common misclassification:
- Finance/Receipts = actual charges, bills, invoices only (not account notifications)
- Action Required = only when YOU must take a specific action (not marketing urgency)
- Important = real human emails only (not automated confirmations or social media)
- Job applications ("thanks for applying") → Recruiting/Job
- Social media notifications → Notifications/Auto-Archive

### Privacy Model

- Email thread data is **ephemeral** — deleted when you sign out
- A daily cron job deletes threads for users inactive 24+ hours
- Persistent data: user account, buckets, sender rules, IMAP account configs
- Read-only Gmail access — the app never modifies your email
- IMAP passwords are encrypted before storage

### AI Graceful Degradation

- If no API key is configured, classification falls back to rules-only
- Invalid keys, quota errors, and model 404s are handled gracefully
- Thread ID validation prevents crashes from AI hallucinations
- Chunked DB writes ensure partial success even if some records fail

### Top 5 Scoring

The AI Top 5 feature scores emails using dimensional data:

- `aiUrgency`: high (+30), medium (+15)
- `aiActionability`: high (+25), low (+10)
- `aiRisk`: high (+20), medium (+10)
- `aiSenderType`: person (+15), bulk (-20)
- Recency: < 6h (+15), < 24h (+10), < 48h (+5)
- Bucket penalties: Newsletters (-15), Auto-Archive (-25)

## Database Schema

5 main tables:

- **User** — Google OAuth account with access/refresh tokens
- **Thread** — Email threads with classification metadata (bucket, confidence, AI dimensions: category, actionability, urgency, risk, sender type)
- **Bucket** — Classification categories with descriptions, examples, sort order
- **SenderRule** — Learned sender-to-bucket mappings with match counts
- **ImapAccount** — IMAP connection configs with encrypted passwords

### Applying Schema Changes

```bash
npx prisma db push        # development
npx prisma migrate dev    # create migration
npx prisma migrate deploy # production
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/classify` | Classify emails (streaming NDJSON) |
| POST | `/api/gmail/sync` | Sync Gmail threads |
| POST | `/api/imap/sync/[id]` | Sync IMAP account |
| POST | `/api/imap/test` | Test IMAP connection |
| GET/POST | `/api/imap/accounts` | List/create IMAP accounts |
| DELETE/PUT | `/api/imap/accounts/[id]` | Manage IMAP account |
| GET/POST | `/api/buckets` | List/create buckets |
| PUT/DELETE | `/api/buckets/[id]` | Update/delete bucket |
| GET | `/api/threads` | List threads (with bucket filter) |
| PUT | `/api/threads/[id]/bucket` | Move thread + create sender rule |
| POST | `/api/threads/[id]/bucket/apply-to-sender` | Bulk apply to all from sender |
| POST | `/api/threads/[id]/summarize` | AI email summary (full body) |
| POST | `/api/suggest-buckets` | AI bucket suggestions |
| POST | `/api/top-emails` | AI Top 5 priority emails |
| GET/DELETE | `/api/sender-rules` | List/clear sender rules |
| DELETE | `/api/sender-rules/[id]` | Delete individual rule |
| POST | `/api/reset` | Full data reset |
| POST | `/api/auth/cleanup` | Clean up session data |

## Deploy to Vercel

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Set all environment variables from `.env.local` in the Vercel dashboard
4. Update `NEXTAUTH_URL` to your production URL
5. Add your production URL to Google OAuth authorized origins and redirect URIs
6. Deploy

The `vercel.json` configures a daily cron job to clean up abandoned session data.

### Required Environment Variables on Vercel

- `DATABASE_URL` — Neon PostgreSQL connection string
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `NEXTAUTH_SECRET` — Random secret for session encryption
- `NEXTAUTH_URL` — Your production URL
- `GOOGLE_AI_API_KEY` — Google AI API key for Gemini
- `ENCRYPTION_KEY` — For IMAP password encryption
- `CRON_SECRET` — Random string for cron job auth

## Project Structure

```
src/
├── app/
│   ├── page.tsx                        # Landing page
│   ├── inbox/
│   │   ├── layout.tsx                  # Main app layout (header, sidebar, classification)
│   │   ├── page.tsx                    # Inbox view (Top 5 + thread list)
│   │   ├── settings/page.tsx           # Settings (IMAP accounts, learned rules)
│   │   └── heatmap/page.tsx            # Heatmap visualization
│   └── api/                            # All API routes (see table above)
├── components/
│   ├── ThreadList.tsx                  # Email thread list with drag-drop and filtering
│   ├── Sidebar.tsx                     # Bucket list, provider filter, sync, retry banner
│   ├── TopEmails.tsx                   # AI Top 5 priority cards
│   ├── OnboardingModal.tsx             # Smart setup flow with progressive classification
│   ├── NewBucketModal.tsx              # Create/edit bucket modal
│   ├── CinematicLoader.tsx             # Canvas dot morphing animation
│   └── ParticleLoader.tsx              # Particle loading effect
└── lib/
    ├── prisma.ts                       # Prisma client (Neon adapter)
    ├── auth.ts                         # NextAuth config + default buckets
    ├── session.ts                      # Auth session helpers
    ├── llm-client.ts                   # LLM client + model detection + fallback
    ├── classify-rules.ts               # 5-layer rule engine + receipt detection
    ├── classify-llm.ts                 # AI classification with fuzzy matching
    ├── gmail.ts                        # Gmail API (sync + full body fetch)
    ├── imap-service.ts                 # IMAP fetch (threads + full body parsing)
    ├── crypto.ts                       # IMAP password encryption
    ├── store.ts                        # Zustand state management
    ├── colors.ts                       # Bucket color assignment
    ├── date.ts                         # Date formatting
    └── rate-limit.ts                   # In-memory rate limiter
```

## Rate Limits

- **Classify**: 5 requests/hour per user
- **Sync**: 10 requests/hour per user
