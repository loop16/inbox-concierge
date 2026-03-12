# Feature: Manual Bucket Reassignment with Learning

Read SPEC.md for full project context.

## Overview
Let the user manually move a thread to a different bucket (click or drag), and have the system learn from that correction. Over time, the classification gets smarter because it builds up a set of sender-level and pattern-level rules from the user's corrections.

## How Learning Works

When a user moves a thread from Bucket A to Bucket B:
1. The thread's bucket is immediately updated
2. The thread is marked as `manualOverride: true` so reclassify never overwrites it
3. A SenderRule is created or updated: "emails from this sender → Bucket B"
4. On the next classify run, the sender rule fires BEFORE the LLM, so it's instant and free

Over time, the user builds up a personal ruleset just by correcting mistakes. The LLM handles fewer and fewer threads because sender rules catch them first.

---

## Data Model Changes

### Add manual override flag to Thread
```prisma
model Thread {
  // ... all existing fields
  manualOverride  Boolean   @default(false)  // user manually assigned this bucket
}
```

### Add SenderRule model
```prisma
model SenderRule {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  senderEmail   String    // the email address pattern to match
  senderDomain  String?   // optional: match entire domain (e.g., "zoom.us")
  bucketId      String
  bucket        Bucket    @relation(fields: [bucketId], references: [id])
  source        String    @default("learned")  // "learned" (from correction) or "manual" (user-created)
  matchCount    Int       @default(0)  // how many times this rule has fired
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([userId, senderEmail])
}
```

Add relations:
```prisma
model User {
  // ... existing fields
  senderRules   SenderRule[]
}

model Bucket {
  // ... existing fields
  senderRules   SenderRule[]
}
```

Run `npx prisma db push` after updating.

---

## API Routes

### PUT /api/threads/[id]/bucket
Move a thread to a different bucket manually.

```typescript
// Body: { bucketId: string }
// Steps:
//   1. Update the thread: set bucketId, manualOverride = true, confidence = 1.0, reason = "Manually assigned"
//   2. Create or update a SenderRule for this thread's senderEmail → new bucketId
//      - If a rule already exists for this sender, update the bucketId
//      - Set source = "learned"
//   3. Optionally: check if there are OTHER threads from the same sender in
//      the current (wrong) bucket. If so, offer to move them too.
//      For MVP: just return a count of how many other threads from this sender exist.
//   4. Return: { 
//        updated: true, 
//        ruleCreated: true, 
//        senderEmail: "...",
//        otherThreadsFromSender: number 
//      }
```

### POST /api/threads/[id]/bucket/apply-to-sender
After moving a thread, the user can click "Apply to all from this sender" to bulk-move.

```typescript
// Body: { bucketId: string }
// Steps:
//   1. Get the thread's senderEmail
//   2. Update ALL threads from this sender (for this user) to the new bucketId
//      EXCEPT threads with manualOverride that were moved to a DIFFERENT bucket
//   3. Return: { moved: number }
```

### GET /api/sender-rules
List all sender rules for the current user.

```typescript
// Response: [{ id, senderEmail, senderDomain, bucket: { id, name }, matchCount, source, createdAt }]
```

### DELETE /api/sender-rules/[id]
Delete a sender rule.

---

## Classification Pipeline Update

Update the classification pipeline in the classify route to add sender rules as a new step, between the existing rule engine and the LLM:

### Updated order:
1. **Manual overrides** — skip any thread with `manualOverride: true` (never reclassify these)
2. **Sender rules** — check SenderRule table for the thread's senderEmail. If match, assign bucket, set reason = "Sender rule: {senderEmail} → {bucketName}", confidence = 0.95. Increment the rule's matchCount.
3. **Domain rules** — check SenderRule table for senderDomain matches (e.g., all emails from zoom.us). If match, assign bucket.
4. **Built-in rules** — the existing keyword/domain/label rules (newsletters, receipts, etc.)
5. **LLM classification** — everything remaining goes to the AI

This means learned sender rules are the FIRST thing checked (after manual overrides), so they're fast, free, and take priority over everything else.

### Update the classify route response to include:
```typescript
{
  classified: number,
  skippedManualOverrides: number,
  senderRules: number,
  builtInRules: number,
  llmBased: number,
  failed: number,
}
```

---

## Thread List UI: Reassign Bucket

### Option A: Click to reassign (simpler, do this)
Add a bucket selector to each thread row or the expanded thread view:

- Show the current bucket as a colored pill/tag (already exists)
- Clicking the pill opens a small dropdown of all buckets
- Selecting a different bucket calls PUT /api/threads/[id]/bucket
- After the move:
  - Thread pill updates immediately (optimistic UI)
  - Show a small toast/snackbar: "Moved to Newsletters. Apply to all from moondev@zoom.us?" with a clickable "Apply" action
  - If user clicks "Apply", call POST /api/threads/[id]/bucket/apply-to-sender
  - Show result: "Moved 12 more threads from this sender"
- The dropdown should also show a subtle indicator if a sender rule already exists: "✓ Rule: always → Newsletters"

### Option B: Drag to reassign (stretch, skip for MVP)
Allow dragging a thread row to a bucket in the sidebar. This is nice UX but complex to implement. Save for later.

### Expanded thread view additions
When a thread is expanded, show:
- Classification source: "Classified by: AI" or "Classified by: Sender rule" or "Classified by: Manual" or "Classified by: Newsletter detection"
- If there's a sender rule for this sender, show: "Rule: emails from moondev@zoom.us → Auto-Archive"

---

## Sidebar Updates

### Bucket counts should update in real-time
After a manual move, the sidebar bucket counts should update immediately. Use React Query's `invalidateQueries` on the buckets query after a move.

### Rules indicator
Next to the Settings gear icon in the sidebar, add a small "Rules" link or make it part of Settings. Shows the count of active sender rules: "Rules (23)"

---

## Settings Page: Sender Rules Section

Add a "Learned Rules" section to the Settings page (below Email Accounts, above AI Provider):

- Table/list of all sender rules
- Columns: Sender Email, Bucket, Times Matched, Source (learned/manual), Created
- Each row has a Delete button (with confirmation)
- "Clear All Rules" button at the bottom (with confirmation)
- Sort by matchCount descending (most-used rules at top)

---

## Toast/Notification System

If the app doesn't already have a toast system, add one. Use a simple approach:
- Zustand store for toasts: `{ id, message, action?, actionLabel? }`
- Toast component: slides in from bottom-right, auto-dismisses after 5 seconds
- Action button on toast for "Apply to all from sender"

Or use shadcn/ui's toast component if available.

---

## Build Order

1. Update Prisma schema (manualOverride on Thread, SenderRule model), run db push
2. Build PUT /api/threads/[id]/bucket route
3. Build POST /api/threads/[id]/bucket/apply-to-sender route  
4. Build GET /api/sender-rules and DELETE /api/sender-rules/[id]
5. Update classification pipeline: add sender rule step, skip manual overrides
6. Build the bucket selector dropdown on thread rows
7. Build the toast system (or wire up shadcn toast)
8. Wire up the "Apply to all from sender" flow
9. Add sender rules section to Settings page
10. Update sidebar counts to refresh on move
11. Polish: optimistic UI, loading states, confirmation dialogs

---

## Verification

- npm run dev starts without errors

Manual reassignment:
- Click a thread's bucket pill → dropdown appears with all buckets
- Select a different bucket → thread moves immediately
- Toast appears: "Moved to [bucket]. Apply to all from [sender]?"
- The moved thread stays in its new bucket even after reclassify (manualOverride works)

Learning:
- After moving a thread, a SenderRule is created (check in Prisma Studio or Settings page)
- Sync new emails → emails from the same sender auto-route to the learned bucket
- Reclassify → sender rules fire before LLM, threads from learned senders get correct bucket
- The classify response shows senderRules count > 0

Apply to sender:
- Click "Apply" in the toast → all threads from that sender move to the new bucket
- Count shown is correct

Sender Rules in Settings:
- Rules page shows all learned rules with match counts
- Deleting a rule works
- After deleting a rule, reclassify no longer uses it

Classification priority:
- Manual overrides are never overwritten by reclassify
- Sender rules fire before built-in rules and LLM
- Built-in rules still work for non-learned senders
- LLM only handles threads with no applicable rule

- npx tsc --noEmit passes
- npm run lint passes

When all verifications pass, output <promise>LEARNING_DONE</promise>
