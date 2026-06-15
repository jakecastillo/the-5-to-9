#!/usr/bin/env bash
# The 5 to 9 — SessionStart hook: inject a ONE-LINE awareness note (kept tiny to
# avoid permanent context cost). If a shift is active, re-prime beads cheaply.
# Always exits 0. Git-Bash-compatible.

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || exit 0

cat >/dev/null 2>&1 || true   # drain stdin payload

# Node preflight: the irreversible-action gate runs primarily on Node (it falls
# back to the bash classifier, but the operator should know if node is missing
# before trusting the gate on a long hands-off run).
f9_node_warn=""
if ! command -v node >/dev/null 2>&1; then
  f9_node_warn="⚠️ The 5 to 9: 'node' is not on PATH — the irreversible-action gate falls back to bash. Install Node 18+ (or expose 'node') for the primary, faster gate. "
fi

if f9_shift_active; then
  goal="$(f9_state_get goal 2>/dev/null)"
  note="The 5 to 9: a shift is ACTIVE (goal: ${goal:-unset}). Follow the running-the-shift skill; /shift-status to peek, /clock-out to end. The repo's own CLAUDE.md/AGENTS.md win over the crew."
  if f9_have bd; then f9_export_beads_dir; bd prime >/dev/null 2>&1 || true; fi
else
  note="The 5 to 9 is installed — say 'clock in' or run /clock-in [goal] to start a hands-off night shift on this repo."
fi

note="${f9_node_warn}${note}"
ctx="$(printf '%s' "$note" | f9_json_string)"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$ctx"
exit 0
