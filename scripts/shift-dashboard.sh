#!/usr/bin/env bash
# The 5 to 9 — shift dashboard (phu.3).
# READ-ONLY: never writes beads, state, or git. POSIX bash, Git-Bash-compatible.
# shellcheck shell=bash
#
# Usage:
#   bash scripts/shift-dashboard.sh              # render once and exit
#   bash scripts/shift-dashboard.sh --watch      # live-refresh loop (Ctrl-C to stop)
#   bash scripts/shift-dashboard.sh --watch --interval 5   # refresh every 5 s
#   bash scripts/shift-dashboard.sh --watch --refreshes 3  # bounded: 3 refreshes then exit
#   FIVE_TO_NINE_DASH_MAX_REFRESHES=N bash scripts/shift-dashboard.sh --watch
#                                                # env-var bounding (useful in tests)
#
# Composition seams:
#   f9_dash_bead_lists   — phu.3.2: ready / in_progress / blocked lists
#   f9_dash_status_panel — phu.3.1: top-level status panel
#   f9_dash_loop         — phu.3.3: refresh loop + main entrypoint
#
# Each function is self-contained so callers can source this file and compose freely.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$HERE/lib/common.sh"

# ---------------------------------------------------------------------------
# Color helpers — NO_COLOR / non-TTY / TERM=dumb aware.
#
# _dash_color_on: returns 0 (true) when color is appropriate, 1 otherwise.
#   Rules (in priority order):
#     1. NO_COLOR set (any value)  → no color (spec: https://no-color.org)
#     2. TERM=dumb                 → no color
#     3. FIVE_TO_NINE_DASH_FORCE_COLOR=1 → color (test hook / explicit opt-in)
#     4. stdout is a TTY [ -t 1 ]  → color
#     5. otherwise                 → no color (piped/captured output)
#
# _dash_c <sgr>: emit ESC[<sgr>m when color is on, nothing otherwise.
#   Common sgr codes: 0=reset  1=bold  2=dim  31=red  32=green
# ---------------------------------------------------------------------------
_dash_color_on() {
  # NO_COLOR wins unconditionally (standard env var).
  [[ -n "${NO_COLOR+x}" ]] && return 1
  # TERM=dumb means the terminal cannot handle escape sequences.
  [[ "${TERM:-}" == "dumb" ]] && return 1
  # Explicit opt-in (test hook or script caller).
  [[ "${FIVE_TO_NINE_DASH_FORCE_COLOR:-0}" == "1" ]] && return 0
  # Real TTY check.
  [[ -t 1 ]] && return 0
  return 1
}

_dash_c() {
  _dash_color_on && printf '\033[%sm' "$1" || true
}

# ---------------------------------------------------------------------------
# Internal: emit a section header (bold when color is on).
# Usage: _dash_header <label>
# ---------------------------------------------------------------------------
_dash_header() {
  printf '\n%s── %s ──%s\n' "$(_dash_c 1)" "$*" "$(_dash_c 0)"
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
# Internal: extract the first integer from a string (bd count output).
# ---------------------------------------------------------------------------
_dash_first_int() { grep -oE '[0-9]+' | head -n1; }

# ---------------------------------------------------------------------------
# f9_dash_summary — phu.3.4
# Render a one-line at-a-glance summary header:
#   closed / ready / in_progress / blocked counts + progress (closed/total).
# Strictly read-only — no bd/git writes. Exits 0 always.
# Graceful fallback when bd is absent.
# ---------------------------------------------------------------------------
f9_dash_summary() {
  if ! f9_have_beads; then
    printf '  bd not available — install beads (bd) for summary counts\n'
    return 0
  fi

  # Fetch counts via bd count --status <X>; default 0 on failure.
  local closed ready in_progress blocked total pct
  closed="$(bd count --status closed 2>/dev/null | _dash_first_int)"
  closed="${closed:-0}"
  # "ready" is a computed unblocked-open VIEW, not a status — bd count --status ready is
  # always 0. Use the real ready query (f9_ready_count = bd ready --json | length).
  ready="$(f9_ready_count 2>/dev/null | _dash_first_int)"
  ready="${ready:-0}"
  in_progress="$(bd count --status in_progress 2>/dev/null | _dash_first_int)"
  in_progress="${in_progress:-0}"
  blocked="$(bd count --status blocked 2>/dev/null | _dash_first_int)"
  blocked="${blocked:-0}"

  total=$(( closed + ready + in_progress + blocked ))

  # Progress: "closed/total (XX%)" — guard against divide-by-zero.
  if [[ "$total" -gt 0 ]]; then
    pct=$(( closed * 100 / total ))
    printf '  closed:%s  ready:%s  in_progress:%s  blocked:%s  |  progress: %s/%s (%s%%)\n' \
      "$closed" "$ready" "$in_progress" "$blocked" "$closed" "$total" "$pct"
  else
    printf '  closed:%s  ready:%s  in_progress:%s  blocked:%s  |  progress: 0/0\n' \
      "$closed" "$ready" "$in_progress" "$blocked"
  fi

  return 0
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

  # BLOCKED header: red label when color is on.
  printf '\n%s── BLOCKED ──%s\n' "$(_dash_c 31)$(_dash_c 1)" "$(_dash_c 0)"
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
  local status_val="${status:-unknown}"
  local status_colored
  case "$status_val" in
    active)   status_colored="$(_dash_c 32)${status_val}$(_dash_c 0)" ;;  # green
    inactive) status_colored="$(_dash_c 2)${status_val}$(_dash_c 0)"  ;;  # dim
    *)        status_colored="$status_val" ;;
  esac
  printf '  status:    %s\n' "$status_colored"
  printf '  goal:      %s\n' "${goal:-(none)}"
  printf '  branch:    %s\n' "${branch:-(none)}"
  printf '  iteration: %s / %s\n' "$iter_count" "$max_display"

  # --- last gate result (read-only: last-gate.txt written by validate-plugin.sh) ---
  # Format in file: "GREEN|RED <group-count> <UTC-ISO-timestamp>"
  # Rendered as:    "gate: GREEN (18 groups) — 2026-06-16T12:34:56Z"  or  "gate: n/a"
  local gate_file gate_color gate_n gate_ts
  gate_file="$(f9_state_dir)/last-gate.txt"
  if [[ -f "$gate_file" ]]; then
    # Read the first line; tolerate trailing whitespace / newlines.
    IFS= read -r gate_line < "$gate_file" 2>/dev/null || gate_line=""
    gate_color="${gate_line%% *}"           # first word: GREEN or RED
    gate_rest="${gate_line#* }"             # remainder: "<n> <ts>"
    gate_n="${gate_rest%% *}"              # second word: group count
    gate_ts="${gate_rest#* }"              # third word: timestamp
    printf '  gate: %s (%s groups) — %s\n' "$gate_color" "$gate_n" "$gate_ts"
  else
    printf '  gate: n/a\n'
  fi

  return 0
}

# ---------------------------------------------------------------------------
# f9_dash_render — one full render pass (summary + status panel + bead lists).
# Strictly read-only.
# ---------------------------------------------------------------------------
f9_dash_render() {
  printf 'Shift Dashboard\n'
  _dash_header "SUMMARY"
  f9_dash_summary
  f9_dash_status_panel
  f9_dash_bead_lists
  printf '\n'
}

# ---------------------------------------------------------------------------
# f9_dash_loop — phu.3.3: live-refresh watch loop.
#
# Parameters (all optional):
#   --interval <seconds>   Seconds between refreshes (default: 2).
#   --refreshes <N>        Exit after N refreshes (default: unbounded / until signal).
#
# Environment (alternative bounding mechanism, convenient for tests):
#   FIVE_TO_NINE_DASH_MAX_REFRESHES=N  Same as --refreshes N; --refreshes wins if both set.
#
# Traps SIGINT and SIGTERM for a clean exit (code 0).
# Strictly read-only — never writes beads, state, or git.
# ---------------------------------------------------------------------------
f9_dash_loop() {
  local interval=2
  local max_refreshes="${FIVE_TO_NINE_DASH_MAX_REFRESHES:-0}"  # 0 = unbounded

  # Parse local flags.
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval)
        interval="${2:?--interval requires a value}"; shift 2 ;;
      --refreshes)
        max_refreshes="${2:?--refreshes requires a value}"; shift 2 ;;
      *)
        shift ;;
    esac
  done

  # Clean exit on SIGINT / SIGTERM.
  local _loop_done=0
  trap '_loop_done=1' INT TERM

  local count=0
  while [[ "$_loop_done" -eq 0 ]]; do
    # Clear screen then render.
    printf '\033[2J\033[H'
    f9_dash_render

    count=$(( count + 1 ))

    # Bounded exit.
    if [[ "$max_refreshes" -gt 0 ]] && [[ "$count" -ge "$max_refreshes" ]]; then
      break
    fi

    # Sleep in short increments so SIGINT wakes us promptly.
    local slept=0
    while [[ "$_loop_done" -eq 0 ]] && [[ "$slept" -lt "$interval" ]]; do
      sleep 1
      slept=$(( slept + 1 ))
    done
  done

  # Restore default signal handling.
  trap - INT TERM
  return 0
}

# ---------------------------------------------------------------------------
# main — entrypoint.
# Supports:
#   (no args)              render once and exit
#   --watch [opts…]        live-refresh loop (see f9_dash_loop for options)
#   --source-only          source functions only; do not run main (for tests)
# ---------------------------------------------------------------------------
main() {
  # Parse top-level flags; collect remainder to pass to loop.
  local watch_mode=0
  local -a loop_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --watch)
        watch_mode=1; shift ;;
      --interval|--refreshes)
        loop_args+=("$1" "${2:?$1 requires a value}"); shift 2 ;;
      *)
        shift ;;
    esac
  done

  if [[ "$watch_mode" -eq 1 ]]; then
    f9_dash_loop "${loop_args[@]+"${loop_args[@]}"}"
  else
    f9_dash_render
  fi
}

# Allow callers to source this file without running main (e.g. tests).
if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
