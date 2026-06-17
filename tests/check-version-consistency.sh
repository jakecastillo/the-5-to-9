#!/usr/bin/env bash
# The 5 to 9 — version-consistency checker.
# Asserts every version-bearing source agrees on ONE version string, so a release
# bump can't silently drift (a plugin manifest left behind, a stale README badge).
# Pure bash + grep/sed (no jq), so it runs the same in CI, Git-Bash, and the gate.
#
# usage: check-version-consistency.sh [ROOT]      (ROOT defaults to the repo root)
# exit 0 = all agree (prints "version consistent: X"); non-zero = drift (prints a
#          table naming every source and its version, so the offender is obvious).
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

json_version()  { grep -m1 -E '"version"[[:space:]]*:' "$1" 2>/dev/null \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
badge_version() { grep -m1 -oE 'badge/version-[0-9][^-]*-' "$1" 2>/dev/null \
  | sed -E 's:badge/version-([^-]*)-:\1:'; }
cff_version()   { grep -m1 -E '^version:[[:space:]]' "$1" 2>/dev/null \
  | sed -E 's/^version:[[:space:]]*//; s/[[:space:]]*$//'; }

names=(); vers=()
record() { names+=("$1"); vers+=("$2"); }

record ".claude-plugin/plugin.json"      "$(json_version  "$ROOT/.claude-plugin/plugin.json")"
record ".claude-plugin/marketplace.json" "$(json_version  "$ROOT/.claude-plugin/marketplace.json")"
record ".codex-plugin/plugin.json"       "$(json_version  "$ROOT/.codex-plugin/plugin.json")"
record ".cursor-plugin/plugin.json"      "$(json_version  "$ROOT/.cursor-plugin/plugin.json")"
record ".agents/plugins/the-5-to-9/.codex-plugin/plugin.json" \
  "$(json_version "$ROOT/.agents/plugins/the-5-to-9/.codex-plugin/plugin.json")"
record "driver/package.json"             "$(json_version  "$ROOT/driver/package.json")"
record "CITATION.cff"                    "$(cff_version    "$ROOT/CITATION.cff")"
record "README.md (badge)"               "$(badge_version "$ROOT/README.md")"

ref="${vers[0]}"
drift=0
for i in "${!names[@]}"; do
  [[ -z "${vers[$i]}" || "${vers[$i]}" != "$ref" ]] && drift=1
done

if [[ "$drift" -ne 0 ]]; then
  echo "version drift — sources disagree (anchor '.claude-plugin/plugin.json' = '${ref:-<none>}'):"
  for i in "${!names[@]}"; do printf '  %-52s %s\n' "${names[$i]}" "${vers[$i]:-<none>}"; done
  exit 1
fi
echo "version consistent: $ref"
exit 0
