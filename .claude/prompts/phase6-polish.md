Read the full project spec in SPEC.md at the project root. That is your source of truth.

PHASE 6: Polish, error handling, edge cases, and final QA.

CONTEXT: Phases 1-5 are complete. The full app works: auth, sync, UI, classification. This phase is about making it solid.

TASKS:
1. Error handling:
   - If Gmail sync fails with 401 (token expired), show "Session expired, please sign in again" and redirect to sign-in
   - If Gmail sync fails with 429 (rate limit), show "Gmail rate limit hit, try again in a minute"
   - If classification fails, show which batches failed and allow retry
   - All API routes should return proper HTTP status codes and error messages
   - Client-side: catch all fetch errors and show user-friendly toasts/alerts

2. Loading states:
   - Sync button: spinner + "Syncing..." text, disable button while running
   - Classify button: progress indicator "Classifying batch 3 of 17..."
   - Thread list: skeleton shimmer while loading
   - Bucket sidebar: skeleton while loading
   - Page transitions: no flash of unstyled content

3. Empty states:
   - No threads at all: "Your inbox is empty. Click Sync to pull in your latest emails."
   - No threads in selected bucket: "No emails in this bucket yet."
   - No buckets (shouldn't happen but): "No buckets configured."

4. Edit and delete buckets:
   - Right-click or "..." menu on each bucket in sidebar
   - Edit: opens the bucket modal pre-filled with current values
   - Delete: confirmation dialog, then delete bucket and set orphaned threads' bucketId to null
   - Cannot delete default buckets (or add a warning)
   - PUT /api/buckets/[id] and DELETE /api/buckets/[id] routes

5. Visual polish:
   - Consistent color palette — pick one and stick with it
   - Proper font hierarchy: headings, body, captions
   - Hover states on all interactive elements
   - Focus rings for accessibility
   - Smooth transitions on thread expand/collapse (150ms ease)
   - Bucket tags should have consistent sizing
   - Date formatting: use relative dates (just now, 5m ago, 2h ago, Yesterday, Mon, Mar 5)
   - Thread list should have subtle alternating row backgrounds or divider lines

6. Keyboard shortcuts (nice to have):
   - j/k to navigate threads
   - Enter to expand/collapse
   - Escape to deselect

7. Final QA checklist — go through each one:
   - [ ] Fresh sign-in works
   - [ ] Sync pulls threads correctly
   - [ ] Classification assigns reasonable buckets
   - [ ] Bucket filtering works
   - [ ] Creating a custom bucket works
   - [ ] Reclassify after adding a custom bucket works
   - [ ] Edit bucket works
   - [ ] Delete bucket works
   - [ ] Thread expand/collapse works
   - [ ] Sign out works
   - [ ] Sign back in preserves data
   - [ ] No console errors
   - [ ] No TypeScript errors (run npx tsc --noEmit)
   - [ ] ESLint passes (npm run lint)

VERIFICATION:
- npm run dev starts without errors
- npx tsc --noEmit has no errors
- npm run lint has no errors (or only minor warnings)
- All items in the QA checklist above pass
- The app looks professional and polished
- No janky loading states, no unstyled flashes, no broken layouts

If all verifications pass, output <promise>PHASE6_DONE</promise>

This is the final phase. Make it feel like a real app, not a prototype. Do NOT output the promise until the QA checklist fully passes.
