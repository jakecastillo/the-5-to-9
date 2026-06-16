#!/usr/bin/env bash
# The 5 to 9 — reusable Git-Bash launcher for hook additionalContext JSON.
# Reads context text on stdin and emits a hookSpecificOutput additionalContext
# envelope. Prefer the zero-dep Node helper; fall back to bash f9_json_string
# when node is absent. If neither path can emit valid JSON, fail closed.

set -uo pipefail

hook_event="${1:-}"
if [[ -z "$hook_event" ]]; then
  printf 'json-context: usage: json-context.sh <HookEventName>\n' >&2
  exit 64
fi

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
f9_node=""
if [[ -z "${F9_JSON_CONTEXT_SKIP_NODE:-}" ]]; then
  f9_node="$(command -v node 2>/dev/null || true)"
  if [[ -z "$f9_node" ]] && command -v claude >/dev/null 2>&1; then
    f9_cdir="$(dirname "$(command -v claude 2>/dev/null)")"
    for f9_c in "$f9_cdir/node" "$f9_cdir/node.exe"; do
      [[ -x "$f9_c" ]] && { f9_node="$f9_c"; break; }
    done
  fi
fi

if [[ -n "$f9_node" && -f "$HERE/json-context.mjs" ]]; then
  exec "$f9_node" "$HERE/json-context.mjs" "$hook_event"
fi

if ! command -v f9_json_string >/dev/null 2>&1; then
  printf 'json-context: node unavailable and f9_json_string fallback unavailable\n' >&2
  exit 1
fi

ctx_raw="$(cat 2>/dev/null || true)"
event_json="$(printf '%s' "$hook_event" | F9_NO_JQ=1 f9_json_string)"
ctx_json="$(printf '%s' "$ctx_raw" | F9_NO_JQ=1 f9_json_string)"
printf '{"hookSpecificOutput":{"hookEventName":%s,"additionalContext":%s}}\n' "$event_json" "$ctx_json"
