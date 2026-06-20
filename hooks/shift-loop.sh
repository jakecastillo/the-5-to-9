#!/usr/bin/env bash
# The 5 to 9 — Stop hook launcher for the beads-aware shift loop (the ralph heartbeat).
# The loop logic lives in the zero-dep Node port (shift-loop.mjs): it reproduces the
# cap / drain / no-progress-stall / block-allow transitions and the block JSON. This
# launcher just finds a node runtime and execs it.
#
# Fail OPEN: when no node runtime is available, exit 0 (= allow the stop). A loop hook
# that can't run must never TRAP the user in an endless block — better to clock out and
# let them drive manually. (Contrast the irreversible gate, which fails CLOSED.)
# Always exits 0. Git-Bash-compatible.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prefer node on PATH; fall back to a node shipped next to the `claude` binary
# (the host runtime) when PATH is bare — same resolution the other launchers use.
f9_node="$(command -v node 2>/dev/null || true)"
if [[ -z "$f9_node" ]] && command -v claude >/dev/null 2>&1; then
  f9_cdir="$(dirname "$(command -v claude 2>/dev/null)")"
  for f9_c in "$f9_cdir/node" "$f9_cdir/node.exe"; do
    [[ -x "$f9_c" ]] && { f9_node="$f9_c"; break; }
  done
fi

if [[ -n "$f9_node" && -f "$HERE/shift-loop.mjs" ]]; then
  exec "$f9_node" "$HERE/shift-loop.mjs"
fi

# No node runtime → fail OPEN: drain the Stop payload and allow the stop.
cat >/dev/null 2>&1 || true
exit 0
