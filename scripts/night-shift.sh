#!/usr/bin/env bash
# The 5 to 9 — the fresh-process night-shift loop (the hands-off engine).
# Each iteration restarts the agent with CLEAN context, works ONE bead, exits.
# Always capped (default 30). Git-Bash-compatible. Reversible work only.
#
# usage: night-shift.sh [--max-iterations N] [--goal "..."] [--dry-run]
#   --max-iterations N   hard cap on iterations (default 30; required to be >= 1)
#   --goal "..."         optional standing goal woven into each iteration's prompt
#   --dry-run            run the loop logic without invoking the agent (for tests)
# env: FIVE_TO_NINE_AGENT_CMD (override the agent invocation; gets $FIVE_TO_NINE_PROMPT),
#      FIVE_TO_NINE_MAX_ITER, FIVE_TO_NINE_NOPROGRESS (stall threshold, default 3).
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$F9_HERE/lib/common.sh"
# shellcheck source=beads-helpers.sh
. "$F9_HERE/beads-helpers.sh"

max_iter="${FIVE_TO_NINE_MAX_ITER:-30}"
goal=""
dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iterations|-n) max_iter="${2:-}"; shift 2 || true;;
    --max-iterations=*)  max_iter="${1#*=}"; shift;;
    --goal|-g)           goal="${2:-}"; shift 2 || true;;
    --goal=*)            goal="${1#*=}"; shift;;
    --dry-run)           dry_run=1; shift;;
    -h|--help)           grep -E '^#( |$)' "$F9_HERE/night-shift.sh" | sed 's/^# \{0,1\}//' >&2; exit 0;;
    *)                   f9_warn "ignoring unknown arg: $1"; shift;;
  esac
done

[[ "$max_iter" =~ ^[0-9]+$ ]] || { f9_err "--max-iterations must be a positive integer (got: '$max_iter')"; exit 2; }
(( max_iter >= 1 )) || { f9_err "--max-iterations must be >= 1"; exit 2; }

f9_export_beads_dir

PROMPT="$(cat <<EOF
You are running ONE iteration of a The 5 to 9 night shift — a fresh process with clean
context. Follow the running-the-shift skill. Do exactly one unit of work, then stop:
1) Claim the next ready bead: bd ready --claim --json. If none, print QUEUE-EMPTY and stop.
2) Implement it as the Dealer, test first (TDD); fail-on-stub before you make it pass.
3) Run the repo's real mechanical gate (typecheck/lint/test/build). No green, no close.
4) Verify independently as the Floor Auditor against the bead's acceptance criteria.
5) Commit on the shift branch (never main/prod), then bd close the bead and note why in beads.
Hard-stop and SURFACE (never perform) any irreversible outward action:
deploy/publish, git push --force, deleting remote data, destroying/rotating secrets.
${goal:+Shift goal: $goal}
EOF
)"

run_agent() {
  local p="$1"
  if [[ -n "${FIVE_TO_NINE_AGENT_CMD:-}" ]]; then
    FIVE_TO_NINE_PROMPT="$p" bash -c "$FIVE_TO_NINE_AGENT_CMD"
  elif f9_have claude; then
    claude -p "$p" --dangerously-skip-permissions
  else
    f9_err "no agent CLI found — set FIVE_TO_NINE_AGENT_CMD or install 'claude'"
    return 127
  fi
}

f9_log "night shift starting — cap ${max_iter} iteration(s)$([[ $dry_run -eq 1 ]] && echo ' (dry-run)')"
iter=0; prev_closed=-1; stall=0; stall_max="${FIVE_TO_NINE_NOPROGRESS:-3}"

while (( iter < max_iter )); do
  ready="$(f9_ready_count 2>/dev/null || echo 0)"; [[ "$ready" =~ ^[0-9]+$ ]] || ready=0
  if (( ready == 0 )); then
    f9_log "QUEUE-EMPTY — backlog drained after ${iter} iteration(s)"; break
  fi

  closed="$(f9_bd_closed_count 2>/dev/null || true)"
  if [[ -n "$closed" ]]; then
    if [[ "$closed" == "$prev_closed" ]]; then stall=$((stall+1)); else stall=0; fi
    prev_closed="$closed"
    if (( stall >= stall_max )); then
      f9_warn "no-progress: closed count stuck at ${closed} for ${stall} iteration(s) — stopping"; break
    fi
  fi

  iter=$((iter+1))
  f9_log "── iteration ${iter}/${max_iter} · ${ready} ready · closed=${closed:-?} ──"
  if (( dry_run == 1 )); then
    f9_log "[dry-run] would advance one bead (agent not invoked)"; continue
  fi
  run_agent "$PROMPT" || f9_warn "iteration ${iter}: agent returned nonzero (continuing)"
done

f9_log "night shift ended after ${iter} iteration(s)"
echo "Night shift complete: ${iter} iteration(s). Run 'bd status' / 'bd ready', then /clock-out for the report."
