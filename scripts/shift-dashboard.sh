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
# f9_dash_status_panel — phu.3.1
# Render the top-level shift status: active?, goal, branch, iteration, gate.
# Strictly read-only (no bd/git writes). Exits 0 always.
# State is read from:
#   $(f9_state_dir)/shift.local.md   — YAML frontmatter (status/goal/branch/max_iterations)
#   $(f9_state_dir)/iteration.count  — current iteration number (plain integer file)
# ---------------------------------------------------------------------------
f9_dash_status_panel() {
  _dash_header "SHIFT STATUS"

  if ! f9_shift_active; then
    printf '  no active shift\n'
    return 0
  fi

  # --- read state fields (all read-only) ---
  local status goal branch max_iter
  status="$(f9_state_get status 2>/dev/null || printf 'unknown')"
  goal="$(f9_state_get goal 2>/dev/null || printf '')"
  branch="$(f9_state_get branch 2>/dev/null || printf '')"
  max_iter="$(f9_state_get max_iterations 2>/dev/null || printf '')"

  # --- iteration count from iteration.count file ---
  local count_file iter_count
  count_file="$(f9_state_dir)/iteration.count"
  if [[ -f "$count_file" ]]; then
    iter_count="$(cat "$count_file" 2>/dev/null | tr -d '[:space:]')"
  else
    iter_count="0"
  fi

  # --- format max_iterations: "uncapped" → ∞ ---
  local max_display
  if [[ -z "$max_iter" ]] || [[ "$max_iter" == "uncapped" ]]; then
    max_display="∞"
  else
    max_display="$max_iter"
  fi

  # --- render ---
  printf '  status:    %s\n' "${status:-unknown}"
  printf '  goal:      %s\n' "${goal:-(none)}"
  printf '  branch:    %s\n' "${branch:-(none)}"
  printf '  iteration: %s / %s\n' "$iter_count" "$max_display"

  # --- last gate result (cheaply available via last-gate-result file, else n/a) ---
  local gate_file gate_result
  gate_file="$(f9_state_dir)/last-gate-result"
  if [[ -f "$gate_file" ]]; then
    gate_result="$(cat "$gate_file" 2>/dev/null | tr -d '[:space:]')"
    printf '  last gate: %s\n' "${gate_result:-n/a}"
  fi

  return 0
}

# ---------------------------------------------------------------------------
# f9_dash_loop placeholder seam for phu.3.3 (not implemented yet).
# ---------------------------------------------------------------------------
# f9_dash_loop() { :; }   # phu.3.3 will implement this

# ---------------------------------------------------------------------------
# main — minimal entrypoint; calls the status panel + lists once and exits.
# Supports --source-only to allow tests to source functions without running main.
# phu.3.3 will replace this with the refresh loop.
# ---------------------------------------------------------------------------
main() {
  printf 'Shift Dashboard\n'
  f9_dash_status_panel
  f9_dash_bead_lists
  printf '\n'
}

# Allow callers to source this file without running main (e.g. tests).
if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
