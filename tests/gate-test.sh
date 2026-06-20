#!/usr/bin/env bash
# The 5 to 9 — gate regression test. Runs the irreversible-gate against the
# deny/allow corpus (tests/gate-cases.txt) and fails if any verdict regresses.
# This is the proof test for the safety model: revert a gate fix and it goes red.
#
# The corpus is run TWICE so it pins behaviour across BOTH classifier paths:
#   1. default      — whatever the launcher picks (the Node .mjs when node exists).
#   2. bash+no-jq   — the fail-closed fallback, forced via F9_GATE_SKIP_NODE +
#                     F9_NO_JQ. CI/most devs have node, so without this forced pass
#                     the bash fallback would never be exercised by the gate corpus.
# A command that can only be expressed with whitespace a single corpus line can't
# hold uses the tokens <NL> (newline) and <TAB> (tab), expanded here before the
# payload is built — that's how multiline outward-action bypass cases are encoded.
# Git-Bash + ubuntu CI. Needs no bd. Usage: gate-test.sh [cases-file]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
GATE="$ROOT/hooks/irreversible-gate.sh"
CASES="${1:-$HERE/gate-cases.txt}"

[[ -f "$GATE" ]]  || { echo "gate-test: gate not found: $GATE" >&2; exit 2; }
[[ -f "$CASES" ]] || { echo "gate-test: cases not found: $CASES" >&2; exit 2; }

have_jq=0; command -v jq >/dev/null 2>&1 && have_jq=1

payload_for() {  # build a PreToolUse payload wrapping the command (jq encodes real
                 # control chars as \uXXXX/\n; the sed fallback handles the simple cases)
  local c="$1"
  if [[ "$have_jq" -eq 1 ]]; then
    jq -nc --arg c "$c" '{tool_name:"Bash",tool_input:{command:$c}}'
  else
    printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' \
      "$(printf '%s' "$c" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t' '  ')"
  fi
}

# run_corpus <label> [VAR=val ...] — env assignments are exported into the gate only.
run_corpus() {
  local label="$1"; shift
  local fail=0 n=0 bad=0 line want cmd out got
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in ''|'#'*) continue ;; esac
    want="${line%% *}"
    cmd="${line#* }"
    cmd="${cmd//<NL>/$'\n'}"
    cmd="${cmd//<TAB>/$'\t'}"
    out="$(payload_for "$cmd" | env "$@" bash "$GATE" 2>/dev/null)"
    if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then got=deny; else got=allow; fi
    n=$((n + 1))
    if [[ "$got" != "$want" ]]; then
      printf 'FAIL  [%s] expected=%-5s got=%-5s : %s\n' "$label" "$want" "$got" "${cmd//$'\n'/\\n}" >&2
      fail=1; bad=$((bad + 1))
    fi
  done < "$CASES"
  if [[ "$fail" -eq 0 ]]; then
    printf '  [%s] %d/%d verdicts correct\n' "$label" "$n" "$n"
    return 0
  fi
  printf '  [%s] %d/%d FAILED — safety regression\n' "$label" "$bad" "$n" >&2
  return 1
}

rc=0
run_corpus "default"        || rc=1
run_corpus "bash+no-jq"  F9_GATE_SKIP_NODE=1 F9_NO_JQ=1 || rc=1

if [[ "$rc" -eq 0 ]]; then
  total="$(grep -cvE '^[[:space:]]*($|#)' "$CASES")"
  printf 'gate corpus: %s/%s verdicts correct on both paths (default + bash+no-jq fallback)\n' "$total" "$total"
  exit 0
else
  printf 'gate corpus: FAILED — safety regression (see [path] above)\n' >&2
  exit 1
fi
