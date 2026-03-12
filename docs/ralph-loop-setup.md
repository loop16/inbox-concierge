# Inbox Concierge — Ralph Wiggum Loop Setup

## Prerequisites
1. Claude Code installed and authenticated with your Max subscription
2. Ralph Wiggum plugin installed: `/plugin install ralph-wiggum@claude-plugins-official`
3. Google Cloud project set up (see SPEC.md → "Google Cloud Setup")
4. `.env.local` ready with your Google credentials + NEXTAUTH_SECRET
5. `jq` installed (`brew install jq` on Mac, `sudo apt install jq` on Linux)

## How This Works
This project uses **phased Ralph loops**. Each phase builds one layer of the app and verifies it works before the next phase starts. You run them in order.

The full spec is in `SPEC.md` — it gets copied into the project root so Claude Code can reference it during every loop iteration.

## Quick Start

```bash
# 1. Run the bootstrap script (scaffolds the project + copies files)
chmod +x bootstrap.sh
./bootstrap.sh

# 2. cd into the project
cd inbox-concierge

# 3. Add your .env.local (you need to create this yourself)
cat > .env.local << 'EOF'
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
NEXTAUTH_SECRET=your-generated-secret
NEXTAUTH_URL=http://localhost:3000
EOF

# 4. Run phases in order inside Claude Code
claude

# Then in Claude Code:
/ralph-loop "$(cat .claude/prompts/phase1-scaffold.md)" --max-iterations 10
# Wait for completion, then:
/ralph-loop "$(cat .claude/prompts/phase2-auth-db.md)" --max-iterations 20
# Then:
/ralph-loop "$(cat .claude/prompts/phase3-gmail-sync.md)" --max-iterations 20
# Then:
/ralph-loop "$(cat .claude/prompts/phase4-ui.md)" --max-iterations 25
# Then:
/ralph-loop "$(cat .claude/prompts/phase5-classification.md)" --max-iterations 30
# Then:
/ralph-loop "$(cat .claude/prompts/phase6-polish.md)" --max-iterations 20
```

## Or Run It All Overnight

```bash
chmod +x run-all-phases.sh
./run-all-phases.sh
```

This runs all 6 phases sequentially using `claude -p`. Go to sleep, wake up to an app.

## If Something Breaks
- Cancel a running loop: `/cancel-ralph`
- Check what iteration you're on: look at `.claude/ralph-loop.local.md`
- Re-run a phase: just run the same `/ralph-loop` command again
- Claude Code sees all prior file changes, so re-running is safe
