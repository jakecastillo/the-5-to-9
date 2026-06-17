#!/usr/bin/env bash
# The 5 to 9 — SessionStart hook: inject a ONE-LINE awareness note (kept tiny to
# avoid permanent context cost). If a shift is active, re-prime beads cheaply.
# Always exits 0. Git-Bash-compatible.
#
# JSON envelope is built by hooks/json-context.sh (which dispatches to the zero-dep
# Node helper when node is present, and falls back to bash f9_json_string when not).

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || exit 0

cat >/dev/null 2>&1 || true   # drain stdin payload

# QUIET BY DEFAULT. A plugin must not inject its identity into unrelated sessions, or
# normal tasks "inherit" The 5 to 9 (identity bleed). So SessionStart speaks ONLY when a
# shift is ACTIVE in this repo — re-priming the crew. When idle it stays SILENT (no note,
# no banner). Prereq preflight moved to clock-in (scripts/setup-shift.sh), where missing
# tools actually matter — not every cold session. Discovery is via /clock-in or the README.
if ! f9_shift_active; then
  exit 0
fi

goal="$(f9_state_get goal 2>/dev/null)"
note="The 5 to 9: a shift is ACTIVE (goal: ${goal:-unset}). Follow the running-the-shift skill; /shift-status to peek, /clock-out to end. The TARGET repo's own CLAUDE.md/AGENTS.md win over the crew — The 5 to 9 is the tool, not the project."
if f9_have bd; then f9_export_beads_dir; bd prime >/dev/null 2>&1 || true; fi

printf '%s' "$note" | bash "$F9_ROOT/hooks/json-context.sh" "SessionStart"
exit 0
