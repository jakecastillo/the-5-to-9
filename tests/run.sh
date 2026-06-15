#!/usr/bin/env bash
# The 5 to 9 — CI entrypoint. Thin alias for the test gate.
set -uo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-plugin.sh" "$@"
