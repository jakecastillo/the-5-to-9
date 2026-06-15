#!/usr/bin/env bash
# The 5 to 9 — end-to-end smoke test of the shift lifecycle in a throwaway repo.
# Proves the MECHANICS (not the crew's intelligence): setup-shift writes state,
# the Stop-loop no-ops with no active shift (no-clobber) and blocks with ready
# work, a scripted cook drains the backlog via night-shift.sh, and clock-out
# clears the shift. bd-independent parts run in CI; the full loop runs where bd
# exists. Git-Bash + ubuntu CI.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail=0
ok() { printf '  ✅ %s\n' "$*"; }
no() { printf '  ❌ %s\n' "$*"; fail=1; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

export CLAUDE_PLUGIN_ROOT="$ROOT"
export CLAUDE_PROJECT_DIR="$TMP"
( cd "$TMP" && git init -q 2>/dev/null ) || true

state="$TMP/.claude/five-to-nine/shift.local.md"

# 1. setup-shift writes an active shift state.
bash "$ROOT/scripts/setup-shift.sh" --no-branch "smoke goal" >/dev/null 2>&1
if [[ -f "$state" ]] && grep -q '^status: active' "$state"; then
  ok "setup-shift wrote active shift state"
else
  no "setup-shift did not write active state"
fi

# 2. no-clobber: with no active shift, the Stop hook is silent (allows stop).
mv "$state" "$state.bak" 2>/dev/null || true
out="$(printf '{}' | bash "$ROOT/hooks/shift-loop.sh" 2>/dev/null)"
[[ -z "$out" ]] && ok "Stop hook is a no-op when no shift is active (no-clobber)" \
                || no "Stop hook should be silent with no active shift (got: $out)"
mv "$state.bak" "$state" 2>/dev/null || true

if command -v bd >/dev/null 2>&1; then
  ( cd "$TMP" && bd init >/dev/null 2>&1 && \
    for i in 1 2 3; do bd create -t task "smoke work $i" >/dev/null 2>&1; done )
  export BEADS_DIR="$TMP/.beads"

  # 3. Stop hook blocks while there is ready work.
  blk="$(printf '{}' | bash "$ROOT/hooks/shift-loop.sh" 2>/dev/null)"
  printf '%s' "$blk" | grep -q '"decision":"block"' \
    && ok "Stop hook blocks (advances the loop) with ready work" \
    || no "Stop hook should block with ready work"

  # 4. a scripted cook drains the backlog through night-shift.sh.
  export FIVE_TO_NINE_AGENT_CMD='id=$(bd ready --claim --json 2>/dev/null | jq -r ".[0].id // empty"); [ -n "$id" ] && bd close "$id" >/dev/null 2>&1'
  ( cd "$TMP" && bash "$ROOT/scripts/night-shift.sh" --max-iterations 12 ) >"$TMP/ns.log" 2>&1 || true
  rem="$(cd "$TMP" && bd ready --json 2>/dev/null | jq 'length' 2>/dev/null || echo '?')"
  [[ "$rem" == "0" ]] && ok "night-shift drained the backlog (ready=0)" \
                      || no "night-shift left ready work (ready=$rem)"
  grep -q 'QUEUE-EMPTY' "$TMP/ns.log" && ok "night-shift reported QUEUE-EMPTY" \
                                      || no "night-shift did not report QUEUE-EMPTY"

  # 5. clock-out clears the active shift.
  bash "$ROOT/scripts/clock-out.sh" >/dev/null 2>&1
  [[ ! -f "$state" ]] && ok "clock-out cleared the active shift state" \
                      || no "clock-out left the shift active"
else
  ok "bd not installed — ran bd-independent checks only (CI mode)"
fi

if [[ "$fail" -eq 0 ]]; then
  echo "smoke-shift: GREEN"
  exit 0
else
  echo "smoke-shift: RED"
  exit 1
fi
