Read the full project spec in SPEC.md at the project root. That is your source of truth.

PHASE 4: Build the full inbox UI — sidebar, thread list, bucket filtering.

CONTEXT: Phases 1-3 are complete. Auth works, Gmail sync works, threads are in DB, buckets exist.

TASKS:
1. Set up React Query provider in src/app/providers.tsx (alongside the session provider).

2. Create a zustand store at src/lib/store.ts:
   - selectedBucketId: string | null (null = "All")
   - setSelectedBucketId(id: string | null)
   - syncLoading: boolean
   - classifyLoading: boolean

3. Build the inbox layout at src/app/inbox/layout.tsx:
   - Sidebar (left, fixed width ~280px) + main content area
   - Top bar with user email, avatar (first letter circle), sign-out button
   - Responsive: sidebar collapses on mobile

4. Build the Sidebar component at src/components/Sidebar.tsx:
   - "All" option at top (shows total thread count)
   - List of buckets, each showing: colored dot, bucket name, thread count badge
   - Clicking a bucket filters the thread list (use zustand store)
   - Active bucket is highlighted
   - Divider line
   - "Sync Inbox" button — calls POST /api/gmail/sync, shows spinner, refreshes thread list after
   - "Classify" button — calls POST /api/classify (this won't work yet, that's fine — just wire the button to call the route and handle the eventual response)
   - "New Bucket" button — opens a modal (build the modal but the create logic comes in phase 5 overlap — for now just make it call POST /api/buckets)

5. Build the ThreadList component at src/components/ThreadList.tsx:
   - Fetches from GET /api/threads?bucketId=... using React Query
   - Each thread row shows:
     - Subject (bold, truncated)
     - Sender name
     - Date (relative: "2h ago", "Yesterday", "Mar 5")
     - Snippet (gray, truncated to 1 line)
     - Bucket tag (colored pill) if assigned
     - Confidence indicator (green/yellow/red dot based on confidence score, if present)
   - Click a thread row to expand it inline, showing:
     - Full snippet text
     - Classification reason (if classified)
     - Sender email
   - Click again to collapse
   - Empty state: "No threads yet. Click Sync Inbox to get started."

6. Build the NewBucketModal component at src/components/NewBucketModal.tsx:
   - Overlay modal
   - Fields: name (required text input), description (textarea), examples (textarea with placeholder "e.g., emails from bloomberg.com, subjects about market data")
   - Save button calls POST /api/buckets, then refreshes bucket list
   - Cancel button closes modal

7. Color system for buckets:
   - Assign each bucket a color from a fixed palette based on its sortOrder or index
   - Use the color for the sidebar dot and the thread list pill
   - Palette suggestion: blue, green, amber, red, purple, teal, pink, gray (matches 8 defaults)

8. Add proper loading skeletons:
   - Thread list shows shimmer skeleton rows while loading
   - Sidebar shows skeleton while buckets load

VERIFICATION:
- npm run dev starts without errors
- Sign in → /inbox shows the sidebar + thread list layout
- Sidebar shows 8 default buckets with counts
- "All" is selected by default, thread list shows all threads
- Clicking a bucket filters the thread list (will show 0 for most since nothing is classified yet)
- Clicking "All" shows all threads again
- "Sync Inbox" button works, shows spinner, refreshes list
- Thread rows show subject, sender, date, snippet
- Clicking a thread row expands it to show more detail
- "New Bucket" button opens the modal
- Creating a bucket via modal adds it to the sidebar
- The UI looks clean — not janky, not unstyled, proper spacing and alignment
- Mobile: sidebar collapses or becomes a drawer

If all verifications pass, output <promise>PHASE4_DONE</promise>

Focus on making this look GOOD. Use proper spacing, font weights, subtle borders, hover states. This is the main screen the user will live in. Do NOT output the promise until the UI is polished and functional.
