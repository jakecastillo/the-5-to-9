#!/usr/bin/env bash
# TDD for the version-consistency checker (tests/check-version-consistency.sh):
# it must PASS on the aligned repo and FAIL — naming the offender — the moment any
# one version-bearing source drifts. Pure bash; runs in CI, Git-Bash, and the gate.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CHECK="$HERE/check-version-consistency.sh"
fail=0

# 1. the real repo must be internally consistent (the positive case)
if bash "$CHECK" "$ROOT" >/dev/null 2>&1; then
  echo "✅ real repo is version-consistent"
else
  echo "❌ real repo reports version drift:"; bash "$CHECK" "$ROOT" 2>&1 | sed 's/^/   /'; fail=1
fi

# 2. an injected drift must be caught AND the offending file named (the negative case)
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
files=(
  .claude-plugin/plugin.json .claude-plugin/marketplace.json
  .codex-plugin/plugin.json .cursor-plugin/plugin.json
  .agents/plugins/the-5-to-9/.codex-plugin/plugin.json
  driver/package.json cli/package.json CITATION.cff README.md
)
for f in "${files[@]}"; do
  mkdir -p "$SANDBOX/$(dirname "$f")"; cp "$ROOT/$f" "$SANDBOX/$f"
done
if bash "$CHECK" "$SANDBOX" >/dev/null 2>&1; then
  echo "✅ sandbox copy consistent before injection"
else
  echo "❌ sandbox copy already drifted (copy bug, not the checker):"; bash "$CHECK" "$SANDBOX" 2>&1 | sed 's/^/   /'; fail=1
fi
# drift exactly one manifest, then expect a non-zero exit that names it
sed -i.bak -E 's/"version"[[:space:]]*:[[:space:]]*"[^"]+"/"version": "9.9.9"/' "$SANDBOX/.codex-plugin/plugin.json"
out="$(bash "$CHECK" "$SANDBOX" 2>&1)"; rc=$?
if [[ "$rc" -ne 0 ]] && printf '%s' "$out" | grep -q 'codex-plugin/plugin.json'; then
  echo "✅ injected drift detected + offender named"
else
  echo "❌ injected drift NOT detected (rc=$rc):"; printf '%s\n' "$out" | sed 's/^/   /'; fail=1
fi

if [[ "$fail" -eq 0 ]]; then echo "version-consistency-test: GREEN"; else echo "version-consistency-test: RED"; exit 1; fi
