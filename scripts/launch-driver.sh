#!/usr/bin/env bash
# Launch the deterministic driver. Invoked by /clock-in (hands-off mode). Git-Bash-compatible.
# Reversible only — the irreversible gate hook governs each worker.
set -uo pipefail
F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$F9_ROOT/driver" || { echo "driver/ not found at $F9_ROOT/driver" >&2; exit 1; }
exec npx --no-install tsx src/main.ts "$@"
