#!/usr/bin/env bash
# The 5 to 9 — shared shell helpers.
# Source this; do not execute it. POSIX bash, Git-Bash-compatible (Windows).
# shellcheck shell=bash

# --- guard against double-sourcing -------------------------------------------
if [[ -n "${FIVE_TO_NINE_COMMON_SOURCED:-}" ]]; then return 0 2>/dev/null || true; fi
FIVE_TO_NINE_COMMON_SOURCED=1

# --- paths -------------------------------------------------------------------
# Repo root: prefer CLAUDE_PROJECT_DIR, else git, else cwd.
f9_repo_root() {
  if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
    printf '%s\n' "$CLAUDE_PROJECT_DIR"; return 0
  fi
  local root
  if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$root"; return 0
  fi
  printf '%s\n' "$PWD"
}

f9_state_dir() { printf '%s/.claude/five-to-nine\n' "$(f9_repo_root)"; }
f9_state_file() { printf '%s/shift.local.md\n' "$(f9_state_dir)"; }

# Ensure worktrees (and any cwd) find the main beads DB. beads auto-discovery
# walks up from cwd; a detached worktree can miss the primary repo's .beads,
# so we export BEADS_DIR explicitly when one exists at the repo root.
f9_export_beads_dir() {
  local root beads
  root="$(f9_repo_root)"
  beads="$root/.beads"
  if [[ -d "$beads" ]]; then export BEADS_DIR="$beads"; fi
}

# --- logging (always to stderr; never pollute hook JSON on stdout) -----------
f9_log()  { printf '🌙 [5to9] %s\n' "$*" >&2; }
f9_warn() { printf '⚠️  [5to9] %s\n' "$*" >&2; }
f9_err()  { printf '⛔ [5to9] %s\n' "$*" >&2; }

# --- tool guards -------------------------------------------------------------
f9_have() { command -v "$1" >/dev/null 2>&1; }

f9_require() {
  local missing=0 t
  for t in "$@"; do
    if ! f9_have "$t"; then f9_warn "missing required tool: $t"; missing=1; fi
  done
  return $missing
}

f9_have_beads() { f9_have bd; }

# --- shift state -------------------------------------------------------------
f9_shift_active() { [[ -f "$(f9_state_file)" ]]; }

# Read a frontmatter key (YAML between the first two --- fences) from the state file.
# Usage: f9_state_get <key>
f9_state_get() {
  local key="$1" file
  file="$(f9_state_file)"
  [[ -f "$file" ]] || return 1
  sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$file" \
    | grep "^${key}:" | head -n1 | sed "s/^${key}:[[:space:]]*//" | sed 's/^"\(.*\)"$/\1/'
}

# Everything after the second --- fence is the shift goal/prompt body.
f9_state_body() {
  local file
  file="$(f9_state_file)"
  [[ -f "$file" ]] || return 1
  awk '/^---$/{i++; next} i>=2' "$file"
}

# --- json --------------------------------------------------------------------
# JSON-escape stdin → a quoted JSON string on stdout (prefers jq, falls back).
# The fallback is PURE BASH BUILTINS (read + printf) — no awk/sed/jq/coreutils —
# so it survives a degenerate PATH (e.g. SessionStart firing with an emptied
# PATH, or Git Bash without jq). It wraps in quotes unconditionally, so empty
# input yields "" and any input is correctly quoted. All JSON-mandatory escapes
# are handled: backslash, double-quote, and every control char < 0x20 (the named
# short escapes \b \f \n \r \t, plus \u00XX for the rest) — a raw control char
# would otherwise make the JSON invalid. Set F9_NO_JQ=1 to force the fallback
# (used by the test gate to exercise the no-jq path).
f9_json_string() {
  if [[ -z "${F9_NO_JQ:-}" ]] && f9_have jq; then
    jq -Rs .
    return
  fi
  # Pure-bash fallback. Slurp all of stdin (incl. trailing bytes) into one var.
  # `read -r -d ''` returns non-zero at EOF but still populates $raw with the
  # full stream; we ignore its status on purpose.
  local raw out ch i n hex
  IFS= read -r -d '' raw || true
  out='"'
  n=${#raw}
  for (( i = 0; i < n; i++ )); do
    ch=${raw:i:1}
    case "$ch" in
      '\') out+='\\' ;;
      '"') out+='\"' ;;
      $'\b') out+='\b' ;;
      $'\f') out+='\f' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      *)
        # Other C0 control chars (0x00–0x1F) must be \u-escaped; printf builtin
        # gives us the codepoint. Everything else passes through verbatim.
        printf -v hex '%d' "'$ch"
        if (( hex >= 0 && hex < 32 )); then
          printf -v ch '\\u%04x' "$hex"
        fi
        out+=$ch
        ;;
    esac
  done
  out+='"'
  printf '%s' "$out"
}

# --- beads convenience -------------------------------------------------------
# Count of currently-ready (claimable) issues for the active goal.
f9_ready_count() {
  f9_have_beads || { printf '0\n'; return 1; }
  bd ready --json 2>/dev/null | { f9_have jq && jq 'length' || { grep -o '"id"' || true; } | grep -c .; }
}
