# Feature: AI Provider Settings Page with CLIProxyAPI OAuth Login

Read SPEC.md for full project context.

## Overview
Add a Settings page to Inbox Concierge where users can connect to an AI provider (ChatGPT, Claude, or Gemini) through CLIProxyAPI's OAuth flow — directly from the webapp. No env vars, no terminal commands. Just click "Connect to ChatGPT", authorize in the browser, and classification starts working.

## Prerequisites
CLIProxyAPI must be running locally on the user's machine (localhost:8317). The app talks to it via its Management API. The user installs CLIProxyAPI once; the webapp handles everything else.

## Architecture

```
User clicks "Connect to ChatGPT"
        ↓
Webapp → POST /api/proxy/login { provider: "codex" }
        ↓
Next.js backend → CLIProxyAPI Management API: start OAuth flow
        ↓
CLIProxyAPI opens browser for OAuth
        ↓
User authorizes in browser
        ↓
Webapp polls GET /api/proxy/auth-status?state=...
        ↓
Once "ok" → provider is connected, classification works
        ↓
Classification calls go:
  Next.js → CLIProxyAPI (localhost:8317/v1/chat/completions) → Provider
```

## Data Model Changes

Add to Prisma schema:

```prisma
model AIProviderConfig {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  mode            String   @default("none")  // "proxy", "api-key", "none"
  provider        String?  // "codex" (ChatGPT), "claude", "gemini"
  model           String   @default("gpt-5-mini")
  proxyUrl        String   @default("http://localhost:8317")
  apiKey          String?  // only used if mode = "api-key"
  connected       Boolean  @default(false)
  lastTestedAt    DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Add the relation to the User model:
```prisma
model User {
  // ... existing fields
  aiConfig    AIProviderConfig?
}
```

Run `npx prisma db push` after updating the schema.

## API Routes

### POST /api/proxy/status
Check if CLIProxyAPI is running and what providers are authenticated.

```typescript
// Hit CLIProxyAPI's health endpoint and model list
// GET http://localhost:8317/healthz
// GET http://localhost:8317/v1/models
// Return: { running: boolean, models: string[], providers: string[] }
```

Implementation:
- Try to fetch `http://{proxyUrl}/healthz` — if it responds, proxy is running
- Fetch `http://{proxyUrl}/v1/models` — parse model list to determine which providers are connected
  - Models starting with "gpt-" or "codex-" → ChatGPT/OpenAI connected
  - Models starting with "claude-" → Claude connected
  - Models starting with "gemini-" → Gemini connected
- Return the status

### POST /api/proxy/login
Start an OAuth flow for a specific provider.

```typescript
// Body: { provider: "codex" | "claude" | "gemini" }
//
// CLIProxyAPI Management API endpoints for starting OAuth:
// Codex (ChatGPT): the management API can trigger OAuth flows
// The exact endpoint depends on CLIProxyAPI version, but the
// Management Center UI (router-for-me/Cli-Proxy-API-Management-Center)
// uses the /v0/management/ endpoints to start OAuth flows.
//
// If CLIProxyAPI management API isn't available or you can't trigger
// OAuth programmatically, fall back to showing the user instructions:
// "Run: cliproxyapi --codex-login" in their terminal
//
// Return: { state: string, authUrl?: string } or { fallback: true, command: string }
```

Implementation:
- First, check if the management API is reachable at `http://{proxyUrl}/v0/management/`
- The management secret key (if any) should be configurable — store it in the AIProviderConfig or use a default
- Try to start the OAuth flow via the management API
- If the management API isn't available or doesn't support programmatic login, return a fallback with the CLI command the user needs to run
- Return the state token for polling

### GET /api/proxy/auth-status
Poll the OAuth flow status.

```typescript
// Query: ?state=<state>
// Proxies to: GET http://{proxyUrl}/v0/management/get-auth-status?state=<state>
// Returns: { status: "wait" | "ok" | "error" }
```

### POST /api/proxy/test
Test that classification works with current config.

```typescript
// Send a test classification request through CLIProxyAPI
// Use one dummy email thread and the user's configured model
// Return: { success: boolean, model: string, response?: string, error?: string }
```

### GET /api/ai-config
Get the user's current AI config.

### PUT /api/ai-config
Update the user's AI config (mode, provider, model, apiKey, proxyUrl).

## Frontend: Settings Page

### Create /app/inbox/settings/page.tsx

Layout: centered card within the inbox layout (reuse the sidebar).

Sections:

#### 1. AI Provider Connection
Show current status at top:
- Green badge: "Connected to ChatGPT (gpt-5-mini)" 
- Yellow badge: "Rules only — connect a provider for AI classification"
- Red badge: "CLIProxyAPI not detected"

#### 2. Connection Mode Tabs
Two tabs: "Subscription (Free)" and "API Key"

**Tab: Subscription (Free)**
- Explanation: "Route classification through your existing AI subscription using CLIProxyAPI. No per-token costs."
- Proxy URL field (default: http://localhost:8317, editable)
- Status indicator: "CLIProxyAPI: Running ✓" or "CLIProxyAPI: Not detected ✗"
- If not detected, show install instructions:
  ```
  brew tap router-for-me/tap
  brew install cliproxyapi
  cliproxyapi  # starts the proxy
  ```
- Provider buttons (only shown if proxy is running):
  - "Connect ChatGPT" — starts codex OAuth
  - "Connect Claude" — starts claude OAuth  
  - "Connect Gemini" — starts gemini OAuth
- Each button shows provider status: connected ✓ or not connected
- When user clicks a connect button:
  1. Call POST /api/proxy/login
  2. If authUrl returned, show "Authorizing... Complete the login in your browser"
  3. If fallback returned, show "Run this in your terminal: cliproxyapi --codex-login"
  4. Poll GET /api/proxy/auth-status every 2 seconds
  5. When status is "ok", show success animation, update status
  6. Refresh available models

**Tab: API Key**
- Explanation: "Use an OpenAI API key. Pay-per-token pricing."
- API key input field (password type, with show/hide toggle)
- Save button
- When saved, test the key with POST /api/proxy/test

#### 3. Model Selection
- Dropdown of available models
- If proxy mode: populated from CLIProxyAPI's /v1/models endpoint
- If API key mode: hardcoded list (gpt-5-mini, gpt-5.2, gpt-5.4, gpt-4.1-mini)
- Default: gpt-5-mini
- Show pricing hint: "gpt-5-mini: ~$0.03 per classify run" 

#### 4. Test Button
"Test Classification" button:
- Sends one dummy thread through the full pipeline
- Shows result: "✓ Working — classified as 'Important' in 1.2s"
- Or error: "✗ Failed — connection refused"

### Navigation
Add a "Settings" link to the sidebar, below the bucket list. Use a gear icon.

## Update the LLM Client (src/lib/llm-client.ts)

Replace the env-var based client with one that reads from the database:

```typescript
import OpenAI from "openai";
import { prisma } from "./prisma";

export type LLMMode = "proxy" | "api-key" | "none";

export async function getLLMClientForUser(userId: string): Promise<{
  client: OpenAI | null;
  mode: LLMMode;
  model: string;
  label: string;
}> {
  const config = await prisma.aIProviderConfig.findUnique({
    where: { userId },
  });

  if (!config || config.mode === "none") {
    return { client: null, mode: "none", model: "gpt-5-mini", label: "Rules only" };
  }

  if (config.mode === "proxy") {
    const client = new OpenAI({
      baseURL: `${config.proxyUrl}/v1`,
      apiKey: "not-needed",
    });
    const providerLabel = config.provider === "codex" ? "ChatGPT" : 
                          config.provider === "claude" ? "Claude" : "Gemini";
    return {
      client,
      mode: "proxy",
      model: config.model,
      label: `${providerLabel} Proxy (${config.model})`,
    };
  }

  if (config.mode === "api-key" && config.apiKey) {
    const client = new OpenAI({ apiKey: config.apiKey });
    return {
      client,
      mode: "api-key",
      model: config.model,
      label: `OpenAI API (${config.model})`,
    };
  }

  return { client: null, mode: "none", model: "gpt-5-mini", label: "Rules only" };
}
```

## Update the Classify Route

Update src/app/api/classify/route.ts to use `getLLMClientForUser(userId)` instead of the old env-var based client. Pass the client and model to `classifyWithLLM`.

## Update the Classify LLM Function

Change `classifyWithLLM` to accept a client and model as parameters instead of creating its own:

```typescript
export async function classifyWithLLM(
  client: OpenAI,
  model: string,
  threads: ThreadSummary[],
  buckets: BucketDef[]
): Promise<Classification[]> {
  // ... same logic but use the passed client and model
}
```

## Update Sidebar Status

Replace the env-var based status label with a React Query call to GET /api/ai-config that returns the current mode/label. Show it below the Classify button.

If mode is "none", show the label as a link to /inbox/settings: "AI: Rules only — Set up"

## Seed Default Config

When a new user signs in (in the NextAuth signIn callback), also create a default AIProviderConfig with mode: "none".

## Build Order

1. Update Prisma schema, run db push
2. Build the API routes: /api/ai-config, /api/proxy/status, /api/proxy/login, /api/proxy/auth-status, /api/proxy/test
3. Update llm-client.ts to be user/db-driven
4. Update classify route + classifyWithLLM to accept client/model params
5. Build the Settings page UI
6. Add Settings link to sidebar
7. Update sidebar status indicator
8. Wire up the OAuth flow: connect button → login → poll → success
9. Wire up the test button
10. Polish: loading states, error messages, success animations

## Verification
- npm run dev starts without errors
- /inbox/settings page loads and shows current status
- With CLIProxyAPI NOT running: shows "not detected" with install instructions
- With CLIProxyAPI running: shows "Running ✓" and provider connect buttons
- Clicking "Connect ChatGPT" either:
  - Starts OAuth flow and shows polling state, OR
  - Shows fallback CLI command if management API isn't available
- After connecting, /v1/models shows available models
- Model dropdown populates from available models
- Test Classification button works
- Classify from the inbox page works through the proxy
- API Key tab: entering a key and saving works, test works
- Switching between proxy and API key mode works
- Settings persist across page refreshes (stored in DB)
- Sidebar shows correct status label
- If no provider configured, sidebar shows "AI: Rules only — Set up" link
- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>SETTINGS_DONE</promise>
