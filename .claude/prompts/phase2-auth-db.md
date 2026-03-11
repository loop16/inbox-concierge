Read the full project spec in SPEC.md at the project root. That is your source of truth.

PHASE 2: Authentication with NextAuth.js and Google OAuth.

CONTEXT: Phase 1 is complete. The project is scaffolded with Prisma + SQLite + 8 default buckets.

TASKS:
1. Set up NextAuth.js with the App Router pattern:
   - Create src/app/api/auth/[...nextauth]/route.ts
   - Use the Google provider
   - Request these scopes: openid, email, profile, https://www.googleapis.com/auth/gmail.readonly
   - Set access_type: "offline" and prompt: "consent" in the authorization params to get a refresh token

2. Implement the NextAuth callbacks:
   - jwt callback: on initial sign-in, save access_token, refresh_token, and expires_at to the JWT. On subsequent calls, check if expired and refresh using Google's token endpoint if needed.
   - session callback: expose accessToken on the session object so API routes can use it for Gmail calls.
   - signIn callback: upsert the user in the Prisma User table. Also seed default buckets for new users (check if they already have buckets first).

3. Create a NextAuth session provider wrapper at src/app/providers.tsx and wrap the root layout with it.

4. Build the landing page at src/app/page.tsx:
   - If not signed in: show a simple centered hero with "Inbox Concierge" heading, subtitle "Triage your inbox with AI", and a "Sign in with Google" button
   - If signed in: redirect to /inbox
   - Use Tailwind for styling, keep it clean and minimal

5. Create a placeholder /inbox page at src/app/inbox/page.tsx:
   - Protected route (redirect to / if not authenticated)
   - Show "Welcome, {user.email}" and a sign-out button
   - This is just a placeholder — we'll build the real UI in phase 4

6. Make sure the .env.local file is in .gitignore.

7. Create a .env.example file with:
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   NEXTAUTH_SECRET=
   NEXTAUTH_URL=http://localhost:3000

VERIFICATION:
- npm run dev starts without errors
- Visiting localhost:3000 shows the sign-in page
- Clicking "Sign in with Google" redirects to Google OAuth
- After authorizing, user is redirected to /inbox and sees their email
- Refreshing the page maintains the session
- The User table in Prisma has a row for the signed-in user
- The Bucket table has 8 default buckets for that user
- Sign out works and returns to the landing page

If all verifications pass, output <promise>PHASE2_DONE</promise>

If auth doesn't work, check:
- Is .env.local present with valid Google credentials?
- Are the redirect URIs correct in Google Cloud Console?
- Is NEXTAUTH_URL set to http://localhost:3000?
Fix any issues and re-verify. Do NOT output the promise until everything works.
