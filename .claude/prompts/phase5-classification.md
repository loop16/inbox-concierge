Read the full project spec in SPEC.md at the project root. That is your source of truth. Pay special attention to the "How the LLM Classification Works" and "Classification Pipeline" sections.

PHASE 5: Build the classification engine — rule-based + LLM via Claude Agent SDK.

CONTEXT: Phases 1-4 are complete. Auth, Gmail sync, full UI with sidebar and thread list all work. Threads are in DB but unclassified.

TASKS:
1. Create the rule-based classifier at src/lib/classify-rules.ts:
   - Function: applyRules(thread: Thread, buckets: Bucket[]) → { bucketName: string, reason: string } | null
   - Rules (check in order, return first match):
     a. CATEGORY_PROMOTIONS label → "Newsletters" (reason: "Gmail promotions category")
     b. CATEGORY_SOCIAL label → "Personal" (reason: "Gmail social category")
     c. Sender domain in newsletter list → "Newsletters" (reason: "Known newsletter sender")
        Newsletter domains: substack.com, mailchimp.com, convertkit.com, beehiiv.com, buttondown.email, revue.email, campaignmonitor.com, constantcontact.com, mailerlite.com, sendinblue.com
     d. Subject matches finance keywords → "Finance / Receipts" (reason: matched keyword)
        Keywords: receipt, invoice, payment, order confirmation, transaction, statement, billing, subscription renewed
     e. Subject matches recruiting keywords → "Recruiting / Job" (reason: matched keyword)
        Keywords: job, opportunity, recruiter, hiring, role, position, career, interview, application
     f. Subject matches action keywords → "Action Required" (reason: matched keyword)
        Keywords: action required, urgent, asap, deadline, overdue, reminder, follow up, response needed
   - Make keyword matching case-insensitive
   - Parse labelIds from JSON string before checking

2. Create the LLM classifier at src/lib/classify-llm.ts:
   - Function: classifyWithLLM(threads: ThreadSummary[], buckets: BucketDef[]) → Classification[]
   - Use the @anthropic-ai/claude-code Agent SDK as shown in SPEC.md
   - The prompt should include:
     - All bucket names + descriptions + examples
     - Thread data: threadId (use the DB id, not gmailThreadId), subject, sender, senderEmail, snippet
     - Clear instruction to respond with JSON only
   - Parse the response as JSON
   - Handle errors:
     - If response contains markdown backticks, strip them before parsing
     - If JSON.parse fails, retry the batch once
     - If still fails, return threads as unclassified with reason "Classification failed"
   - Map bucket names in the response to actual bucket IDs

3. IMPORTANT — FALLBACK: The Agent SDK may not work in all environments. Build a fallback:
   - Create src/lib/classify-llm-api.ts that uses the standard @anthropic-ai/sdk with ANTHROPIC_API_KEY
   - In the classify route, try the Agent SDK first. If it throws (e.g., CLI not found), fall back to the API client.
   - If neither works, fall back to rule-only classification and log a warning.
   - Install the fallback SDK: npm install @anthropic-ai/sdk

4. Create the classify API route at src/app/api/classify/route.ts:
   - POST handler
   - Query param: reclassify=true to reclassify all threads (otherwise only unclassified)
   - Steps:
     a. Load user's buckets
     b. Load threads to classify
     c. Run rule-based classifier on all threads first
     d. Collect threads not matched by rules
     e. Batch unmatched threads in groups of 12
     f. Run LLM classification on each batch sequentially with a 1.5-second delay between batches
     g. Update each thread with bucketId, confidence, reason
     h. Return { classified: number, rulesBased: number, llmBased: number, failed: number }

5. Wire the "Classify" button in the sidebar:
   - Calls POST /api/classify
   - Shows progress: "Classifying... (batch 3/17)"
   - On complete, refresh both bucket counts and thread list
   - Show a toast/notification with results: "Classified 200 threads (45 by rules, 148 by AI, 7 failed)"

6. Wire the "Reclassify" button (same button, but with ?reclassify=true):
   - Add a dropdown or hold-to-reclassify behavior, OR just make it always reclassify
   - Your call on UX, but make sure reclassify is accessible

7. Update thread list to show classification results:
   - Bucket pill tag on each thread row
   - Confidence dot (green >= 0.8, yellow >= 0.5, red < 0.5)
   - Expanded view shows the reason

VERIFICATION:
- npm run dev starts without errors
- Sign in, sync inbox (if not already synced)
- Click Classify
- Classification runs without crashing
- Threads get assigned to buckets
- Rule-based matches are correct (newsletters go to Newsletters, receipts go to Finance, etc.)
- LLM-classified threads have reasonable bucket assignments
- Sidebar bucket counts update after classification
- Clicking a bucket shows only its threads
- Thread rows show bucket tags and confidence dots
- Expanding a thread shows the classification reason
- Creating a new bucket and clicking Reclassify reassigns some threads to the new bucket

If all verifications pass, output <promise>PHASE5_DONE</promise>

This is the hardest phase. Take your time. If the Agent SDK doesn't work, make sure the API fallback works. If neither LLM path works, at least make sure rules-only classification works and the UI handles it gracefully. Do NOT output the promise until classification works end-to-end.
