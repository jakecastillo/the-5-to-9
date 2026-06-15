#!/usr/bin/env bash
# The 5 to 9 — gate regression test. Runs the irreversible-gate against the
# deny/allow corpus (tests/gate-cases.txt) and fails if any verdict regresses.
# This is the proof test for the safety model: revert a gate fix and it goes red.
# Git-Bash + ubuntu CI. Needs no bd. Usage: gate-test.sh [cases-file]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
GATE="$ROOT/hooks/irreversible-gate.sh"
CASES="${1:-$HERE/gate-cases.txt}"

[[ -f "$GATE" ]]  || { echo "gate-test: gate not found: $GATE" >&2; exit 2; }
[[ -f "$CASES" ]] || { echo "gate-test: cases not found: $CASES" >&2; exit 2; }

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1

payload_for() {  # build a PreToolUse payload wrapping the command
  local c="$1"
  if [[ "$have_jq" -eq 1 ]]; then
    jq -nc --arg c "$c" '{tool_name:"Bash",tool_input:{command:$c}}'
  else
    printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' \
      "$(printf '%s' "$c" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  fi
}

fail=0; n=0; bad=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in ''|'#'*) continue ;; esac
  want="${line%% *}"
  cmd="${line#* }"
  out="$(payload_for "$cmd" | bash "$GATE" 2>/dev/null)"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then got=deny; else got=allow; fi
  n=$((n + 1))
  if [[ "$got" != "$want" ]]; then
    printf 'FAIL  expected=%-5s got=%-5s : %s\n' "$want" "$got" "$cmd" >&2
    fail=1; bad=$((bad + 1))
  fi
done < "$CASES"

if [[ "$fail" -eq 0 ]]; then
  printf 'gate corpus: %d/%d verdicts correct\n' "$n" "$n"
  exit 0
else
  printf 'gate corpus: %d/%d FAILED — safety regression\n' "$bad" "$n" >&2
  exit 1
fi
