# Migrating fragile bash logic to zero-dependency Node (.mjs)

Date: 2026-06-15 · Decision reached via a judge-panel workflow (Node/Python/Go advocates +
an adversarial constraints-checker), grounded in the actual repo and a working prototype.

## Why

An adversarial review of the v1 bash found three classes of bug that bash makes easy and a
real language makes impossible: a `sed` JSON-escaper that emitted invalid JSON without `jq`,
a `while read` that dropped the last command segment, and stringly-built ERE that was hard to
get right and impossible to unit-test. The logic-heavy, security-critical hooks (the
irreversible gate especially) deserve a testable runtime.

## Decision: Node.js — zero-dependency ESM (`.mjs`), `node --test`, behind bash launchers

| Option | Verdict |
|---|---|
| **Node.js** ✅ | The hosts (Claude Code, Codex CLI) **are Node apps**, so a Node runtime is present by construction. No build step (`.mjs` runs directly). Cross-platform. `JSON.stringify` / real `RegExp` / `for-await` stdin kill all three bug classes. Built-in `node --test` (zero deps). Measured **faster** than the bash gate on Windows (~150ms vs ~500–750ms — bash forks jq+sed+grep+tr per segment). |
| Python ✗ | Best *language*, wrong *runtime*: not bundled by the hosts; on Windows `python` is the Store stub that exits 49 → a naive gate fails **open**. |
| Go ✗ | Highest correctness ceiling but needs a build step + ~6 committed per-platform binaries (~17MB) — frontal violation of the "markdown + JSON + scripts, no compiled artifact" ethos; unsigned `.exe` trips AV. |

### Safety design (non-negotiable)

- **hooks.json is unchanged** — it still invokes `bash ".../x.sh"`, preserving the Git-Bash
  pinning convention. The `.sh` becomes a thin launcher.
- **The gate launcher fails CLOSED.** It execs the Node gate when `node` resolves (PATH, or a
  node beside `claude`); if no node is found it runs the **bash classifier fallback** (kept
  during migration) so a missing runtime never silent-allows.
- **Non-security hooks fail OPEN** (exit 0 silent when node is absent) so a missing runtime
  never blocks a normal session.
- **A SessionStart preflight warns** when `node` is absent.
- **The `tests/gate-cases.txt` corpus is the language-agnostic oracle** — a port is "done"
  iff `tests/gate-test.sh` stays 90/90 and node-vs-bash verdicts match exactly.

## Phases

- **Phase 0 — scaffolding & preflight** ✅ *done*: SessionStart node preflight; `node --test`
  wired into `validate-plugin.sh` + CI; node documented as a hard requirement (AGENTS.md, SECURITY.md).
- **Phase 1 — port the irreversible gate** ✅ *done*: `hooks/irreversible-gate.mjs` (90/90 on
  the corpus, 0 node-vs-bash mismatches, valid JSON for quotes/backslash/newline);
  `irreversible-gate.sh` is the fail-closed launcher + bash fallback; `hooks/gate.test.mjs`
  (85 `node --test` cases).
- **Phase 2 — port the context/loop hooks** *(open)*: `shift-loop.mjs` (Stop loop) behind a
  fail-OPEN launcher, then `session-start` / `user-prompt-submit` / `pre-compact`. Pinned by
  `tests/smoke-shift.sh` + `node --test`.
- **Phase 3 — retire the bash gate fallback** *(open)*: once node is enforced, drop the
  duplicated bash gate body so the gate has one source of truth (still fails closed via the
  preflight-enforced requirement).
- **Phase 4 — NON-goal**: orchestration scripts (`night-shift`, `setup-shift`, `clock-out`,
  `guardrail-scan`) stay POSIX bash — they spawn processes and do git/bd plumbing, which is
  what shell is for. The migration is **partial by design**.

## Status

Phases 0–1 are implemented and green. The remaining work is tracked in beads under the
"Migrate fragile text/JSON logic from bash to zero-dep Node" epic.
