#!/bin/bash
set -e

echo "=== Inbox Concierge — Running All Phases ==="
echo "Started at: $(date)"
echo ""

PHASES=(
    "phase1-scaffold.md:10"
    "phase2-auth-db.md:20"
    "phase3-gmail-sync.md:20"
    "phase4-ui.md:25"
    "phase5-classification.md:30"
    "phase6-polish.md:20"
)

for phase_entry in "${PHASES[@]}"; do
    IFS=':' read -r phase_file max_iter <<< "$phase_entry"
    phase_name="${phase_file%.md}"
    
    echo "============================================"
    echo "Running $phase_name (max $max_iter iterations)"
    echo "Started at: $(date)"
    echo "============================================"
    
    PROMPT=$(cat ".claude/prompts/$phase_file")
    
    claude -p "/ralph-loop \"$PROMPT\" --max-iterations $max_iter"
    
    echo ""
    echo "$phase_name completed at: $(date)"
    echo ""
done

echo "=== All phases complete ==="
echo "Finished at: $(date)"
echo ""
echo "Start the app with: npm run dev"
echo "Open: http://localhost:3000"
