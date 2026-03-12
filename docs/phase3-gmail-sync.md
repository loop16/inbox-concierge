Read the full project spec in SPEC.md at the project root. That is your source of truth.

PHASE 3: Gmail thread sync — fetch threads from Gmail API and store in database.

CONTEXT: Phases 1-2 are complete. Auth works, user is in DB, default buckets exist.

TASKS:
1. Create a Gmail service module at src/lib/gmail.ts:
   - Function: fetchThreadList(accessToken, maxResults=200) — calls Gmail threads.list API
   - Function: fetchThreadDetail(accessToken, threadId) — calls Gmail threads.get to get subject, sender, snippet, date, labels
   - Function: parseThreadHeaders(thread) — extract subject from headers, parse "From" header into sender name + email, get internalDate as Date, get labelIds
   - Use the native fetch API, no googleapis SDK needed. The Gmail API base URL is https://gmail.googleapis.com/gmail/v1/users/me/
   - Handle pagination if needed (but maxResults=200 should be one page)

2. Create the API route at src/app/api/gmail/sync/route.ts:
   - POST handler
   - Get the user's access token from the NextAuth session
   - Call fetchThreadList to get thread IDs
   - Batch-fetch thread details using Promise.all in groups of 10 (to avoid Gmail rate limits)
   - For each thread, upsert into the Thread table with:
     - gmailThreadId
     - subject (from headers)
     - sender (display name from From header)
     - senderEmail (email from From header)
     - snippet (from thread object)
     - date (from internalDate)
     - labelIds (JSON.stringify the array)
     - userId (from session)
   - Return { synced: number }
   - Handle errors gracefully: if Gmail returns 401, return 401 to client. If rate limited, return 429.

3. Create the threads API route at src/app/api/threads/route.ts:
   - GET handler
   - Optional query param: bucketId (filter by bucket)
   - Return threads for the current user, ordered by date desc
   - Include the bucket relation in the response

4. Create the buckets API route at src/app/api/buckets/route.ts:
   - GET handler: return all buckets for current user with thread counts (use _count)
   - POST handler: create a new bucket for current user
   - Validate: bucket name is required, no duplicate names per user

5. Add a "Sync Inbox" button to the /inbox placeholder page that:
   - Calls POST /api/gmail/sync
   - Shows a loading spinner while syncing
   - Shows the result count when done
   - Below it, show a simple list of synced threads (subject, sender, date) fetched from GET /api/threads

VERIFICATION:
- npm run dev starts without errors
- Sign in, go to /inbox
- Click "Sync Inbox"
- Sync completes without errors
- Thread list shows real email threads from your Gmail
- Subjects, senders, and dates look correct
- The Thread table in Prisma has rows matching your Gmail threads
- Running sync again doesn't create duplicate threads (upsert works)
- GET /api/buckets returns 8 buckets with counts of 0

If all verifications pass, output <promise>PHASE3_DONE</promise>

If Gmail API returns errors, check:
- Is the access token being passed correctly?
- Did you request gmail.readonly scope in NextAuth?
- Is the Gmail API enabled in Google Cloud Console?
Fix issues and re-verify. Do NOT output the promise until everything works.
