#!/usr/bin/env bash
# The 5 to 9 — UserPromptSubmit hook: detect a trigger phrase and inject the shift
# bootstrap as ADDITIVE context. Purely additive — never edits the user's files.
# Always exits 0. Git-Bash-compatible.

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || exit 0

payload="$(cat 2>/dev/null || true)"
prompt=""
if f9_have jq; then prompt="$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null)"; fi
[[ -z "$prompt" ]] && prompt="$payload"

shopt -s nocasematch 2>/dev/null || true
if [[ "$prompt" =~ (clock[[:space:]]+in|night[[:space:]]+shift|5[[:space:]]+to[[:space:]]+9) ]]; then
  if f9_shift_active; then
    note="The 5 to 9: a shift is already active — follow the running-the-shift skill and advance the loop (bd ready --claim …). /shift-status to peek, /clock-out to end."
  else
    note="The 5 to 9 trigger detected. To start a night shift, invoke the running-the-shift skill (or run /clock-in [goal]). The crew reads the repo's own CLAUDE.md/AGENTS.md/CONTRIBUTING and OBEYS them first (never modifies them), works a beads backlog on a dedicated shift branch, caps its loop, and hard-stops only on irreversible outward actions. Instruction priority: this repo > The 5 to 9 > defaults."
  fi
  ctx="$(printf '%s' "$note" | f9_json_string)"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$ctx"
fi
exit 0
