#!/usr/bin/env bash
# The 5 to 9 — close the shift: archive gitignored state, print a run summary.
# Invoked by /clock-out. Git-Bash-compatible. Reversible only.
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$F9_HERE/lib/common.sh"
# shellcheck source=beads-helpers.sh
. "$F9_HERE/beads-helpers.sh"

if ! f9_shift_active; then
  echo "No active shift to clock out."
  exit 0
fi

state_dir="$(f9_state_dir)"
state_file="$(f9_state_file)"

goal="$(f9_state_get goal 2>/dev/null || echo '(unknown)')"
branch="$(f9_state_get branch 2>/dev/null || echo '(unknown)')"
started="$(f9_state_get started 2>/dev/null || echo '(unknown)')"
iters="$(cat "$state_dir/iteration.count" 2>/dev/null || echo 0)"
ended="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"

# Preserve the JSONL export so the backlog survives the shift.
f9_bd_export || true

# Archive the active state (still gitignored) and clear live counters so the
# Stop-loop won't re-trigger.
archive_dir="$state_dir/archive"
mkdir -p "$archive_dir" 2>/dev/null || true
stamp="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || echo run)"
mv "$state_file" "$archive_dir/shift-$stamp.md" 2>/dev/null || rm -f "$state_file" 2>/dev/null || true
# If archiving AND removal both failed (locked/read-only dir), neutralize the
# status so the Stop-loop guard (status == active) reliably no-ops — otherwise a
# "closed" shift could resume from iteration 1 on the next Stop event.
if [[ -f "$state_file" ]]; then
  : > "$state_file" 2>/dev/null || printf 'status: closed\n' > "$state_file" 2>/dev/null || true
fi
rm -f "$state_dir/iteration.count" "$state_dir/closed.snapshot" 2>/dev/null || true

f9_log "clocked out — goal: $goal"
cat <<EOF
── Shift closed ──────────────────────────────────────────────
 goal      : $goal
 branch    : $branch
 started   : $started
 ended     : $ended
 iterations: $iters
──────────────────────────────────────────────────────────────
Next: run 'bd status' and 'bd ready' for the full report, then
refine scope and /clock-in the next epic.
EOF
