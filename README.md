# Inbox Concierge

AI-powered email triage. Connect your Gmail (and IMAP accounts), and let AI + rules classify your inbox into smart buckets.

## Features

- **Gmail + IMAP** — Connect Gmail via OAuth, plus Outlook, iCloud, Yahoo, and more via IMAP
- **AI Classification** — Multi-dimensional analysis (urgency, actionability, risk, sender type) powered by OpenAI
- **Smart Rules Engine** — 5-layer rule engine (sender rules, auto-detect, labels, keywords, custom matching) handles 60-80% of emails before AI kicks in
- **AI Top 5** — On-demand scan that picks the 5 emails most needing your attention
- **Privacy-First** — Email thread data is deleted on sign out. Buckets and rules persist.
- **Bucket Customization** — AI-suggested buckets based on your actual email patterns, or create your own
- **Heatmap View** — Visualize your inbox patterns

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: PostgreSQL (Neon) via Prisma 7
- **Auth**: NextAuth with Google OAuth
- **AI**: OpenAI API (gpt-5-mini)
- **Frontend**: React 19, Tailwind CSS v4, Zustand, React Query
- **Deployment**: Vercel

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) database (free tier works)
- Google Cloud project with OAuth credentials (Gmail read-only scope)
- OpenAI API key

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

# OpenAI (shared server-side key for all users)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-5-mini

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
   - Auto-detect (noreply, bulk senders, notification domains)
   - Gmail labels (promotions, social, updates, forums)
   - Keywords (finance, recruiting, action-required patterns)
   - Custom bucket matching (your bucket descriptions/examples)
3. Remaining threads go to AI in parallel batches (40 per batch, 4 concurrent)
4. AI returns multi-dimensional classification: category, actionability, urgency, risk, sender type
5. Dimensions are mapped to buckets with security guardrails

### Privacy Model

- Email thread data is **ephemeral** — deleted when you sign out
- A cleanup cron job deletes threads for users inactive 24+ hours
- Persistent data: user account, buckets, sender rules, IMAP account configs
- Read-only Gmail access — the app never modifies your email

### AI Graceful Degradation

- If the OpenAI API key is missing, invalid, or out of credits, classification falls back to rules-only
- No crashes — the rule engine handles the bulk of classification without AI
- When credits are restored, AI resumes on the next classify run

## Deploy to Vercel

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Set all environment variables from `.env.local` in the Vercel dashboard
4. Update `NEXTAUTH_URL` to your production URL
5. Add your production URL to Google OAuth authorized origins and redirect URIs
6. Deploy

The `vercel.json` configures a cron job that runs every 6 hours to clean up abandoned session data.

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
│   └── ...
└── lib/
    ├── prisma.ts                   # Prisma client (Neon adapter)
    ├── auth.ts                     # NextAuth config
    ├── llm-client.ts               # OpenAI client (server-side)
    ├── classify-rules.ts           # 5-layer rule engine
    ├── classify-llm.ts             # AI classification with dimensional output
    ├── rate-limit.ts               # In-memory rate limiter
    └── ...
```

## Rate Limits

- Sync: 10 requests/hour per user
- Classify: 5 requests/hour per user
