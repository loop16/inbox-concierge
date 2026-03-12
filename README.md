# Inbox Concierge

AI-powered email triage. Connect your Gmail (and IMAP accounts), and let AI + rules classify your inbox into smart buckets.

## Features

- **Gmail + IMAP** — Connect Gmail via OAuth, plus Outlook, iCloud, Yahoo, and more via IMAP
- **AI Classification** — Dual-model architecture using Google Gemini (2.5 Flash for reasoning, 2.5 Flash for classification) with parallel batch processing
- **Smart Rules Engine** — 5-layer rule engine (sender rules, auto-detect, labels, keywords, custom matching) handles 60-80% of emails before AI kicks in
- **Receipt Detection** — Dedicated receipt sender domain list (Lyft, Uber, Amazon, Stripe, etc.) auto-classifies financial emails
- **AI Top 5** — On-demand scan that picks the 5 emails most needing your attention
- **Smart Onboarding** — AI analyzes your inbox and suggests custom buckets alongside defaults, then classifies everything
- **Privacy-First** — Email thread data is deleted on sign out. Buckets and rules persist.
- **Bucket Customization** — AI-suggested buckets based on your actual email patterns, or create your own
- **Heatmap View** — Visualize your inbox patterns
- **Particle Animation** — Smooth loading animation during classification

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: PostgreSQL (Neon) via Prisma 7
- **Auth**: NextAuth with Google OAuth
- **AI**: Google Gemini API (gemini-2.5-flash) via OpenAI-compatible endpoint
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

# Cron security (for cleanup job)
CRON_SECRET=any-random-string
```

#### Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
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

### 4. Set up Neon Database

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

Open [http://localhost:3000](http://localhost:3000), sign in with Google, and sync your inbox.

## How It Works

### Classification Flow

1. **Sync** pulls emails from Gmail/IMAP
2. **Classify** runs a 5-layer rule engine first:
   - Sender rules (learned from your manual assignments)
   - Auto-detect (receipt sender domains, noreply, bulk senders, notification domains)
   - Gmail labels (promotions, social)
   - Keywords (finance, recruiting, action-required patterns)
   - Custom bucket matching (your bucket descriptions/examples)
3. Remaining threads go to Gemini AI in **20 parallel batches of 10 emails**
4. AI classifies each email with strict bucket-matching rules
5. Fuzzy bucket name matching resolves any formatting differences from the AI
6. Results are written in chunked transactions with individual fallback on failure
7. If the primary model returns 404, a fallback chain tries alternative models automatically

### Dual-Model Architecture

| Task | Model | Purpose |
|------|-------|---------|
| Bulk classification | `gemini-2.5-flash` | Accurate email-to-bucket mapping |
| Bucket suggestions | `gemini-2.5-flash` | Analyze inbox patterns, suggest new categories |
| Email summarization | `gemini-2.5-flash` | Concise summaries with action items |
| Top 5 ranking | `gemini-2.5-flash` | Priority ranking with explanations |

All models use Google's OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/`), so the OpenAI SDK works with Gemini out of the box. The app auto-detects which provider is configured and ignores irrelevant env vars (e.g., `OPENAI_MODEL` is ignored when using Gemini).

### Model Fallback Chain

If the primary classification model returns a 404, the system automatically tries:
1. `gemini-2.0-flash-001`
2. `gemini-2.0-flash`

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
- A cleanup cron job deletes threads for users inactive 24+ hours
- Persistent data: user account, buckets, sender rules, IMAP account configs
- Read-only Gmail access — the app never modifies your email

### AI Graceful Degradation

- If no API key is configured, classification falls back to rules-only
- Invalid keys, quota errors, and model 404s are handled gracefully
- Thread ID validation prevents crashes from AI hallucinations
- Chunked DB writes ensure partial success even if some records fail

## Database Schema

The app uses 5 main tables:

- **User** — Google OAuth account with access/refresh tokens
- **Thread** — Email threads with classification metadata (bucket, confidence, AI dimensions)
- **Bucket** — Classification categories (default + AI-suggested + custom)
- **SenderRule** — Learned sender-to-bucket mappings from manual assignments
- **ImapAccount** — IMAP connection configs for non-Gmail accounts

### Applying Schema Changes

After pulling new changes that modify `prisma/schema.prisma`:

```bash
npx prisma db push
```

This applies schema changes to your Neon database. For production, use migrations:

```bash
npx prisma migrate dev --name describe-your-change
npx prisma migrate deploy  # on production
```

## Deploy to Vercel

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Set all environment variables from `.env.local` in the Vercel dashboard
4. Update `NEXTAUTH_URL` to your production URL
5. Add your production URL to Google OAuth authorized origins and redirect URIs
6. Deploy

The `vercel.json` configures a cron job that runs every 6 hours to clean up abandoned session data.

### Environment Variables on Vercel

Required:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `NEXTAUTH_SECRET` — Random secret for session encryption
- `NEXTAUTH_URL` — Your production URL (e.g., `https://your-app.vercel.app`)
- `GOOGLE_AI_API_KEY` — Google AI API key for Gemini
- `CRON_SECRET` — Random string for cron job auth

Optional:
- `LLM_MODEL` — Override classification model (default: `gemini-2.5-flash`)
- `LLM_SMART_MODEL` — Override reasoning model (default: `gemini-2.5-flash`)

> Do NOT set `OPENAI_MODEL` when using Gemini — the app ignores it automatically, but removing it keeps things clean.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── inbox/
│   │   ├── layout.tsx              # Main app layout (header, sidebar, actions)
│   │   ├── page.tsx                # Inbox view (Top 5 + thread list)
│   │   ├── settings/page.tsx       # Settings (email accounts, learned rules)
│   │   └── heatmap/page.tsx        # Heatmap visualization
│   └── api/
│       ├── auth/cleanup/           # Ephemeral data cleanup
│       ├── classify/               # AI + rules classification (NDJSON stream)
│       ├── gmail/sync/             # Gmail sync
│       ├── top-emails/             # AI Top 5
│       ├── suggest-buckets/        # AI bucket suggestions
│       ├── cron/cleanup-threads/   # Cron: delete inactive user threads
│       └── ...
├── components/
│   ├── ThreadList.tsx              # Email thread list with classification UI
│   ├── TopEmails.tsx               # AI Top 5 cards
│   ├── Sidebar.tsx                 # Bucket sidebar
│   ├── OnboardingModal.tsx         # Smart setup flow
│   ├── ParticleLoader.tsx          # Animated particle loading effect
│   └── ...
└── lib/
    ├── prisma.ts                   # Prisma client (Neon adapter)
    ├── auth.ts                     # NextAuth config
    ├── llm-client.ts               # LLM client + dual-model config
    ├── classify-rules.ts           # 5-layer rule engine + receipt detection
    ├── classify-llm.ts             # AI classification with fuzzy matching
    ├── rate-limit.ts               # In-memory rate limiter
    └── ...
```

## Rate Limits

- Sync: 10 requests/hour per user
- Classify: 5 requests/hour per user
