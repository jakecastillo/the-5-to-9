#!/usr/bin/env bash
# The 5 to 9 — the fresh-process night-shift loop (the hands-off engine).
# Each iteration restarts the agent with CLEAN context, works ONE bead, exits.
# Always guarded. Git-Bash-compatible. Reversible work only.
#
# usage: night-shift.sh [--max-iterations N] [--goal "..."] [--dry-run]
#   --max-iterations N   OPTIONAL iteration ceiling (>= 1). Omitted = uncapped:
#                        runs until QUEUE-EMPTY or a no-progress stall (always guarded).
#   --goal "..."         optional standing goal woven into each iteration's prompt
#   --dry-run            run the loop logic without invoking the agent (for tests)
# env: FIVE_TO_NINE_AGENT_CMD (override the agent invocation; gets $FIVE_TO_NINE_PROMPT),
#      FIVE_TO_NINE_MAX_ITER, FIVE_TO_NINE_NOPROGRESS (stall threshold, default 3),
#      FIVE_TO_NINE_STUCK_BEAD_THRESHOLD (default 1),
#      FIVE_TO_NINE_STUCK_BEAD_MODEL (default opus).
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F9_ROOT="$(cd "$F9_HERE/.." && pwd)"
export CLAUDE_PLUGIN_ROOT="$F9_ROOT"
# shellcheck source=lib/common.sh
. "$F9_HERE/lib/common.sh"
# shellcheck source=beads-helpers.sh
. "$F9_HERE/beads-helpers.sh"

max_iter="${FIVE_TO_NINE_MAX_ITER:-}"   # empty = uncapped (guarded by QUEUE-EMPTY + no-progress)
goal=""
dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iterations|-n) max_iter="${2:-}"; shift 2 2>/dev/null || shift;;
    --max-iterations=*)  max_iter="${1#*=}"; shift;;
    --goal|-g)           goal="${2:-}"; shift 2 2>/dev/null || shift;;
    --goal=*)            goal="${1#*=}"; shift;;
    --dry-run)           dry_run=1; shift;;
    -h|--help)           awk 'NR>1 && /^#( |$)/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$F9_HERE/night-shift.sh" >&2; exit 0;;
    *)                   f9_warn "ignoring unknown arg: $1"; shift;;
  esac
done

if [[ -n "$max_iter" ]]; then
  [[ "$max_iter" =~ ^[0-9]+$ ]] || { f9_err "--max-iterations must be a positive integer (got: '$max_iter')"; exit 2; }
  (( max_iter >= 1 )) || { f9_err "--max-iterations must be >= 1"; exit 2; }
fi

f9_export_beads_dir

PROMPT="$(cat <<EOF
You are running ONE iteration of a The 5 to 9 night shift — a fresh process with clean
context. Follow the running-the-shift skill. First, ground in THIS repository: read its
AGENTS.md (and README / CONTRIBUTING) for the project's intent and guardrails, and obey
them — the repo's own rules win (priority: this repo > The 5 to 9 > defaults). Then do
exactly one unit of work, then stop:
1) Claim the next ready bead: bd ready --claim --json. If none, print QUEUE-EMPTY and stop.
Impactful bead check: before editing, read the claimed bead's acceptance and keep a
self-rating vs the goal in beads when the bead asks for strategy/config tuning. If the claimed bead is too broad
for one clean loop, do not pretend it is implementation-ready: split or sharpen it into
well-formed child beads with checkable acceptance, then surface that result instead of
closing the broad bead.
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
  local p="$1" model="${2:-}"
  if [[ -n "${FIVE_TO_NINE_AGENT_CMD:-}" ]]; then
    if [[ -n "$model" ]]; then
      FIVE_TO_NINE_PROMPT="$p" CLAUDE_CODE_SUBAGENT_MODEL="$model" FIVE_TO_NINE_ESCALATED_MODEL="$model" bash -c "$FIVE_TO_NINE_AGENT_CMD"
    else
      FIVE_TO_NINE_PROMPT="$p" bash -c "$FIVE_TO_NINE_AGENT_CMD"
    fi
  elif f9_have claude; then
    if [[ -n "$model" ]]; then
      CLAUDE_CODE_SUBAGENT_MODEL="$model" FIVE_TO_NINE_ESCALATED_MODEL="$model" claude -p "$p" --dangerously-skip-permissions
    else
      claude -p "$p" --dangerously-skip-permissions
    fi
  else
    f9_err "no agent CLI found — set FIVE_TO_NINE_AGENT_CMD or install 'claude'"
    return 127
  fi
}

gate_self_check() {
  local out
  out="$(
    printf '{"tool_input":{"command":"git push --force origin HEAD"}}' \
      | CLAUDE_PLUGIN_ROOT="$F9_ROOT" bash "$F9_ROOT/hooks/irreversible-gate.sh" 2>/dev/null
  )" || true
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    f9_log "irreversible gate self-check passed"
    return 0
  fi
  f9_err "irreversible gate self-check failed — refusing to launch hands-off workers"
  return 1
}

first_ready_id() {
  f9_have_beads || { printf ''; return 1; }
  local json
  json="$(bd ready --json 2>/dev/null)" || { printf ''; return 1; }
  if f9_have jq; then
    printf '%s\n' "$json" | jq -r '.[0].id // empty' 2>/dev/null
  else
    printf '%s\n' "$json" \
      | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | head -n1 \
      | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

gate_self_check || exit 3

f9_log "night shift starting — $([[ -n "$max_iter" ]] && echo "cap ${max_iter} iteration(s)" || echo "uncapped (until QUEUE-EMPTY or no-progress stall)")$([[ $dry_run -eq 1 ]] && echo ' (dry-run)')"
iter=0; prev_progress=""; stall=0; stall_max="${FIVE_TO_NINE_NOPROGRESS:-3}"
stuck_threshold="${FIVE_TO_NINE_STUCK_BEAD_THRESHOLD:-1}"
if ! [[ "$stuck_threshold" =~ ^[0-9]+$ ]] || (( stuck_threshold < 1 )); then
  f9_warn "FIVE_TO_NINE_STUCK_BEAD_THRESHOLD must be >= 1 (got: ${stuck_threshold}); using 1"
  stuck_threshold=1
fi
stuck_model="${FIVE_TO_NINE_STUCK_BEAD_MODEL:-opus}"
stuck_id=""; stuck_failures=0; stuck_escalated=0

while [[ -z "$max_iter" ]] || (( iter < max_iter )); do
  ready="$(f9_ready_count 2>/dev/null || echo 0)"; [[ "$ready" =~ ^[0-9]+$ ]] || ready=0
  if (( ready == 0 )); then
    if [[ -n "$stuck_id" && "$stuck_escalated" -eq 1 && "$dry_run" -eq 0 ]]; then
      ready_id="$stuck_id"
      f9_warn "stuck-bead: no ready beads; resuming in-progress bead ${stuck_id} for escalated retry"
    else
      f9_log "QUEUE-EMPTY — backlog drained after ${iter} iteration(s)"; break
    fi
  else
    ready_id="$(first_ready_id 2>/dev/null || true)"
  fi

  closed="$(f9_bd_closed_count 2>/dev/null || true)"
  open="$(f9_bd_open_count 2>/dev/null || true)"
  progress_sig=""
  if [[ -n "$closed" || -n "$open" ]]; then
    progress_sig="closed=${closed:-?}, open=${open:-?}"
  fi
  if [[ -n "$progress_sig" ]]; then
    if [[ "$progress_sig" == "$prev_progress" ]]; then stall=$((stall+1)); else stall=0; fi
    prev_progress="$progress_sig"
    if (( stall >= stall_max )); then
      f9_warn "no-progress: ${progress_sig} for ${stall} iteration(s) — stopping"; break
    fi
  fi

  iter=$((iter+1))
  f9_log "── iteration ${iter}/${max_iter:-∞} · ${ready} ready · closed=${closed:-?} ──"
  if (( dry_run == 1 )); then
    f9_log "[dry-run] would advance one bead (agent not invoked)"; continue
  fi

  agent_prompt="$PROMPT"
  agent_model=""
  escalated_this_iter=0
  if [[ -n "$ready_id" && "$ready_id" == "$stuck_id" && "$stuck_escalated" -eq 1 ]]; then
    agent_model="$stuck_model"
    escalated_this_iter=1
    agent_prompt="${PROMPT}

Stuck-bead escalation: bead ${ready_id} has failed ${stuck_failures} consecutive hands-off attempt(s). Bump the relevant role one tier by using CLAUDE_CODE_SUBAGENT_MODEL=${stuck_model}. Resume bead ${ready_id} directly, even if it is already in_progress; do not run bd ready --claim for this escalated retry. Keep scope bounded, and surface the exact failure instead of retrying again if the gate still fails."
    f9_warn "stuck-bead: retrying ${ready_id} with model tier ${stuck_model}"
  fi

  if run_agent "$agent_prompt" "$agent_model"; then
    if [[ -n "$ready_id" && "$ready_id" == "$stuck_id" ]]; then
      stuck_id=""; stuck_failures=0; stuck_escalated=0
    fi
  else
    rc=$?
    if [[ -z "$ready_id" ]]; then
      f9_warn "iteration ${iter}: agent returned nonzero (exit ${rc}); could not identify ready bead for stuck tracking"
      continue
    fi

    if [[ "$ready_id" == "$stuck_id" ]]; then
      stuck_failures=$((stuck_failures + 1))
    else
      stuck_id="$ready_id"
      stuck_failures=1
      stuck_escalated=0
    fi

    if (( escalated_this_iter == 1 )); then
      f9_warn "stuck-bead: ${ready_id} failed after escalation to ${stuck_model} (exit ${rc}) — surfacing"
      break
    fi

    if (( stuck_failures >= stuck_threshold )); then
      stuck_escalated=1
      f9_warn "stuck-bead: ${ready_id} failed ${stuck_failures} consecutive attempt(s) — escalating next attempt to ${stuck_model}"
    else
      f9_warn "iteration ${iter}: agent returned nonzero (exit ${rc}; continuing)"
    fi
  fi
done

f9_log "night shift ended after ${iter} iteration(s)"
echo "Night shift complete: ${iter} iteration(s). Run 'bd status' / 'bd ready', then /clock-out for the report."
