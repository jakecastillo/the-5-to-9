#!/usr/bin/env bash
# The 5 to 9 — shift dashboard entrypoint scaffold (phu.3).
# READ-ONLY: never writes beads, state, or git. POSIX bash, Git-Bash-compatible.
# shellcheck shell=bash
#
# Composition seams:
#   f9_dash_bead_lists   — phu.3.2: ready / in_progress / blocked lists (this bead)
#   f9_dash_status_panel — phu.3.1: top-level status panel (sibling, not yet wired)
#   f9_dash_loop         — phu.3.3: refresh loop + main entrypoint (sibling, not yet wired)
#
# Each function is self-contained so phu.3.1 and phu.3.3 can source this file
# and compose freely.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"

# ---------------------------------------------------------------------------
# Internal: emit a section header.
# Usage: _dash_header <label>
# ---------------------------------------------------------------------------
_dash_header() {
  printf '\n── %s ──\n' "$*"
}

# ---------------------------------------------------------------------------
# Internal: parse a JSON array from bd and print one "id  title" line per item.
# Falls back gracefully when jq is absent (grep-based extraction).
# Accepts JSON on stdin.
# ---------------------------------------------------------------------------
_dash_print_beads() {
  local json="$1"
  if [[ -z "$json" ]] || [[ "$json" == "[]" ]]; then
    printf '  (none)\n'
    return
  fi

  if f9_have jq; then
    printf '%s\n' "$json" \
      | jq -r '.[] | "  \(.id)  \(.title // "")"' 2>/dev/null \
      || printf '  (parse error)\n'
  else
    # No jq: extract ids with grep (best-effort, covers the common case).
    local ids
    ids="$(printf '%s\n' "$json" | grep -oE '"id":"[^"]+"' | sed 's/"id":"//;s/"//')"
    if [[ -z "$ids" ]]; then
      printf '  (none)\n'
    else
      while IFS= read -r id; do
        printf '  %s\n' "$id"
      done <<< "$ids"
    fi
  fi
}

# ---------------------------------------------------------------------------
# f9_dash_bead_lists — phu.3.2
# Render ready / in_progress / blocked bead lists sourced from bd.
# Strictly read-only (no bd writes, no git ops).
# Exits 0 always; prints a clear message when bd is absent.
# ---------------------------------------------------------------------------
f9_dash_bead_lists() {
  if ! f9_have_beads; then
    printf 'bd not available — install beads (bd) to view the bead lists\n'
    return 0
  fi

  # Fetch each list. Suppress errors; an empty result is acceptable.
  local ready_json ip_json blocked_json
  ready_json="$(bd ready --json 2>/dev/null || printf '[]')"
  ip_json="$(bd list --status=in_progress --json 2>/dev/null || printf '[]')"
  # Try bd list --status=blocked first; fall back to bd blocked --json.
  blocked_json="$(bd list --status=blocked --json 2>/dev/null \
    || bd blocked --json 2>/dev/null \
    || printf '[]')"

  _dash_header "READY"
  _dash_print_beads "$ready_json"

  _dash_header "IN-PROGRESS"
  _dash_print_beads "$ip_json"

  _dash_header "BLOCKED"
  _dash_print_beads "$blocked_json"
}

# ---------------------------------------------------------------------------
# Placeholder seams for sibling beads (not implemented yet).
# ---------------------------------------------------------------------------
# f9_dash_status_panel() { :; }   # phu.3.1 will implement this
# f9_dash_loop()         { :; }   # phu.3.3 will implement this

# ---------------------------------------------------------------------------
# main — minimal entrypoint; calls the lists once and exits.
# phu.3.3 will replace this with the refresh loop.
# ---------------------------------------------------------------------------
main() {
  printf 'Shift Dashboard\n'
  f9_dash_bead_lists
  printf '\n'
}

main "$@"
