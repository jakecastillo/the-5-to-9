#!/usr/bin/env bash
# Launch the deterministic SDK driver (the off-loop, TypeScript runtime hands-off path).
# This is the SEPARATE dispatch from the bash night-shift.sh loop — do not merge them.
#
# Usage: launch-driver.sh --backend <claude|codex|api> [--goal "..."] [--budget-usd N]
#        [--max-iterations N] [--no-progress-window N]
#
# Concurrency (K):
#   K=1 is the default for subscription backends (claude, codex) — enforced in config.ts.
#   K>=2 requires the metered-api backend (--backend api) — metered API only (spec §2.1).
#   Pass --backend to select; omitting it causes main.ts to exit 1 with a clear message.
#
# Invoked by scripts/clock-in-dispatch.sh --driver (the operator-facing dispatch flag).
# The irreversible gate hook governs each worker. Git-Bash-compatible.
set -uo pipefail
F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$F9_ROOT/driver" || { echo "driver/ not found at $F9_ROOT/driver" >&2; exit 1; }
exec npx --no-install tsx src/main.ts "$@"
