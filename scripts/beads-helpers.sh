#!/usr/bin/env bash
# The 5 to 9 — beads (bd) convenience helpers.
# Source this AFTER lib/common.sh; do not execute it. Git-Bash-compatible.
# shellcheck shell=bash

if [[ -n "${FIVE_TO_NINE_BEADS_SOURCED:-}" ]]; then return 0 2>/dev/null || true; fi
FIVE_TO_NINE_BEADS_SOURCED=1

# Pull in common if a caller sourced us directly.
if [[ -z "${FIVE_TO_NINE_COMMON_SOURCED:-}" ]]; then
  # shellcheck source=lib/common.sh
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
fi

# Extract the first integer from bd's output (count subcommands print a number,
# sometimes with surrounding prose). Empty string = signal unavailable.
f9_first_int() { grep -oE '[0-9]+' | head -n1; }

# Count of issues in a given status, or empty if bd/db unavailable.
# Usage: f9_bd_count_status <open|closed|in_progress|blocked>
f9_bd_count_status() {
  f9_have_beads || { printf ''; return 1; }
  local n
  n="$(bd count --status "$1" 2>/dev/null | f9_first_int)"
  printf '%s' "$n"
}

f9_bd_closed_count() { f9_bd_count_status closed; }
f9_bd_open_count()   { f9_bd_count_status open; }

# Ensure beads is initialized in the current repo. Reversible (creates a local DB).
f9_bd_ensure_init() {
  f9_have_beads || { f9_warn "beads (bd) not found — install it to use the backlog"; return 1; }
  f9_export_beads_dir
  if bd doctor >/dev/null 2>&1; then return 0; fi
  f9_log "initializing beads backlog (bd init)"
  bd init >/dev/null 2>&1 || { f9_warn "bd init failed"; return 1; }
}

# Export the JSONL source-of-truth (commit this; the .db stays gitignored).
f9_bd_export() {
  f9_have_beads || return 1
  f9_export_beads_dir
  bd export >/dev/null 2>&1 || return 1
}
