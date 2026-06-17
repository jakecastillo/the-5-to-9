#!/usr/bin/env bash
# Thin operator-facing dispatch: routes a hands-off run to either the bash loop
# (default) or the TypeScript SDK driver (--driver flag). This is the ONLY place
# that makes the routing decision — night-shift.sh and launch-driver.sh are never
# modified to know about each other.
#
# Usage: clock-in-dispatch.sh [--driver] [--backend <claude|codex|api>] [options...]
#
#   --driver              Use the SDK driver (scripts/launch-driver.sh → driver/src/main.ts).
#                         Defaults to K=1 for subscription backends (claude, codex).
#                         K>=2 requires --backend api (metered API only, spec §2.1).
#                         Requires: node >= 20, pnpm, driver/ deps installed.
#
#   (no --driver flag)    Use the bash night-shift loop (scripts/night-shift.sh, default).
#                         This is the default hands-off engine — no node/pnpm required.
#
# All remaining args are forwarded to the chosen engine verbatim.
#
# Examples:
#   bash clock-in-dispatch.sh --max-iterations 30           # bash loop (default)
#   bash clock-in-dispatch.sh --driver --backend claude     # SDK driver, K=1
#   bash clock-in-dispatch.sh --driver --backend api --budget-usd 10  # SDK driver, K>=2
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
The 5 to 9 — clock-in-dispatch: route a hands-off run to the bash loop or the SDK driver.

usage: clock-in-dispatch.sh [--driver] [--backend <claude|codex|api>] [engine options...]

  --driver        Use the SDK driver (scripts/launch-driver.sh -> driver/src/main.ts).
                  Defaults to K=1 for subscription backends (claude, codex); K>=2
                  requires --backend api (metered API only, spec section 2.1).
                  Requires node >= 20, pnpm, and driver/ deps installed.
  (no --driver)   Use the bash night-shift loop (scripts/night-shift.sh) -- the default
                  hands-off engine, no node/pnpm required.
  -h, --help      Show this help and exit (invokes neither engine).

All remaining args are forwarded verbatim to the chosen engine (e.g. --max-iterations N,
--goal "...", and for --driver: --backend, --budget-usd). See each engine's own --help.

examples:
  bash clock-in-dispatch.sh --max-iterations 30                    # bash loop (default)
  bash clock-in-dispatch.sh --driver --backend claude              # SDK driver, K=1
  bash clock-in-dispatch.sh --driver --backend api --budget-usd 10 # SDK driver, K>=2
EOF
}

use_driver=0
passthrough=()

for arg in "$@"; do
  case "$arg" in
    -h | --help) usage; exit 0 ;;
    --driver)    use_driver=1 ;;
    *)           passthrough+=("$arg") ;;
  esac
done

if [[ "$use_driver" -eq 1 ]]; then
  exec bash "${F9_HERE}/launch-driver.sh" "${passthrough[@]+"${passthrough[@]}"}"
else
  exec bash "${F9_HERE}/night-shift.sh" "${passthrough[@]+"${passthrough[@]}"}"
fi
