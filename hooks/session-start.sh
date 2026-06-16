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

# Prerequisites preflight (fail OPEN): a fresh machine should be /clock-in-ready
# with no manual steps, but if a core tool is missing the operator should hear
# about it up front — one clear line per MISSING tool. A missing tool NEVER
# blocks the session (this hook always exits 0). Each tool gets a tailored hint
# for what it powers; 'node' keeps its gate-specific note since the irreversible
# gate runs primarily on Node (falling back to the bash classifier).
f9_preflight_warn=""
f9_preflight_check() {
  command -v "$1" >/dev/null 2>&1 || f9_preflight_warn="${f9_preflight_warn}⚠️ The 5 to 9: '$1' is not on PATH — $2 "
}
f9_preflight_check claude "Claude Code (the plugin host) isn't visible; install/expose it to run a shift here."
f9_preflight_check bd     "beads (the backlog/memory) isn't available; install it so 'bd ready' and the crew's task tracking work."
f9_preflight_check node   "the irreversible-action gate falls back to bash. Install Node 18+ (20+ for the driver) for the primary, faster gate."
f9_preflight_check git    "branch isolation + the dedicated shift branch need git; install it so the crew can work safely off main."
f9_preflight_check pnpm   "the driver (TypeScript runtime) installs deps with pnpm; install it if you'll run 'cd driver && pnpm install'."
f9_node_warn="$f9_preflight_warn"

if f9_shift_active; then
  goal="$(f9_state_get goal 2>/dev/null)"
  note="The 5 to 9: a shift is ACTIVE (goal: ${goal:-unset}). Follow the running-the-shift skill; /shift-status to peek, /clock-out to end. The repo's own CLAUDE.md/AGENTS.md win over the crew."
  if f9_have bd; then f9_export_beads_dir; bd prime >/dev/null 2>&1 || true; fi
else
  note="The 5 to 9 is installed — say 'clock in' or run /clock-in [goal] to start a hands-off night shift on this repo."
fi

note="${f9_node_warn}${note}"
printf '%s' "$note" | bash "$F9_ROOT/hooks/json-context.sh" "SessionStart"
exit 0
