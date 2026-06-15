#!/usr/bin/env bash
# The 5 to 9 — Stop hook: the beads-aware shift loop (the ralph heartbeat).
# Blocks the stop and re-injects "advance the shift" while there's ready work and
# budget; allows the stop (clock out) when the backlog is drained, the cap is hit,
# or progress stalls. No active shift → no-op (never blocks a normal session).
# Always exits 0. Git-Bash-compatible.

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || exit 0
# shellcheck source=../scripts/beads-helpers.sh
. "$F9_ROOT/scripts/beads-helpers.sh" 2>/dev/null || true

cat >/dev/null 2>&1 || true   # drain stdin payload

# No-clobber: if no shift is active, do nothing and let the session stop normally.
f9_shift_active || exit 0
[[ "$(f9_state_get status 2>/dev/null)" == "active" ]] || exit 0

f9_export_beads_dir
state_dir="$(f9_state_dir)"

max_iter="$(f9_state_get max_iterations 2>/dev/null)"
[[ "$max_iter" =~ ^[0-9]+$ ]] || max_iter="${FIVE_TO_NINE_MAX_ITER:-30}"

iter="$(cat "$state_dir/iteration.count" 2>/dev/null || echo 0)"
[[ "$iter" =~ ^[0-9]+$ ]] || iter=0
iter=$((iter + 1))
# If we can't persist the counter, the cap can't advance across fresh Stop-hook
# processes — fail safe by allowing the stop (observably) rather than looping uncapped.
if ! printf '%s\n' "$iter" > "$state_dir/iteration.count" 2>/dev/null; then
  f9_warn "cannot persist iteration counter ($state_dir/iteration.count) — clocking out to stay capped"
  exit 0
fi

allow_stop() { exit 0; }   # emit nothing → the model is allowed to stop

block() {
  local reason rq
  reason="$1"
  rq="$(printf '%s' "$reason" | f9_json_string)"
  printf '{"decision":"block","reason":%s}\n' "$rq"
  exit 0
}

# Hard cap.
if (( iter > max_iter )); then
  f9_warn "iteration cap reached (${max_iter}) — clocking out the loop"
  allow_stop
fi

# Backlog drained → clock out.
ready="$(f9_ready_count 2>/dev/null || echo 0)"
[[ "$ready" =~ ^[0-9]+$ ]] || ready=0
if (( ready == 0 )); then
  f9_log "no ready beads — backlog drained, clocking out"
  allow_stop
fi

# No-progress guard: stop if the closed count stalls for N iterations.
stall_max="${FIVE_TO_NINE_NOPROGRESS:-3}"
snap="$state_dir/closed.snapshot"; prev=-1; stall=0
if [[ -f "$snap" ]]; then read -r prev stall < "$snap" 2>/dev/null || true; fi
[[ "$prev"  =~ ^-?[0-9]+$ ]] || prev=-1
[[ "$stall" =~ ^[0-9]+$ ]]   || stall=0
closed="$(f9_bd_closed_count 2>/dev/null || true)"
if [[ -n "$closed" ]]; then
  if [[ "$closed" == "$prev" ]]; then stall=$((stall + 1)); else stall=0; fi
  printf '%s %s\n' "$closed" "$stall" > "$snap" 2>/dev/null || true
  if (( stall >= stall_max )); then
    f9_warn "no-progress: closed count stuck at ${closed} for ${stall} iteration(s) — stopping"
    allow_stop
  fi
fi

goal="$(f9_state_get goal 2>/dev/null)"
block "Advance The 5 to 9 shift (iteration ${iter}/${max_iter}). Per the running-the-shift skill: claim the next ready bead (bd ready --claim), implement it TDD as the Line Cook, run the repo's real mechanical gate (no green, no close), have the Health Inspector verify independently against acceptance, commit on the shift branch, then bd close and note why in beads. ${ready} bead(s) ready. Goal: ${goal}. Stop only when bd ready is empty or you hit the cap; hard-stop and surface (never perform) any irreversible outward action."
