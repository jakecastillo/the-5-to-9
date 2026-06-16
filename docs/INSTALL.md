# Install — The 5 to 9

Get from a fresh machine to a running night shift. A freshly-cloned repo is
`/clock-in`-ready with **zero manual setup steps** — the beads backlog
auto-initializes from the committed export on first clock-in, and all project
context comes from the repo (`README` / `AGENTS.md` / `CLAUDE.md`) + beads, not
from any dev-machine-local state.

## 1. Prerequisites

| Tool | Why | Install hint |
|------|-----|-------------|
| `claude` | the plugin host (Claude Code CLI) | <https://docs.anthropic.com/claude-code> (`npm i -g @anthropic-ai/claude-code`) |
| `bd` (beads) | the backlog + crew memory | <https://github.com/steveyegge/beads> (`brew install steveyegge/tap/beads` or see releases) |
| `node` ≥ 18 (≥ 20 for the driver) | powers the irreversible-action gate (falls back to bash if absent); the TypeScript driver needs Node 20+ | <https://nodejs.org> or `nvm install 20` |
| `git` | branch isolation + the dedicated shift branch | <https://git-scm.com> |
| `pnpm` | installs the driver's dependencies | `npm i -g pnpm` or <https://pnpm.io/installation> |

On a fresh session, the **SessionStart preflight warns once per missing tool**
and never blocks — you can clock in with a partial toolchain (you'll just lose
the feature each missing tool powers).

## 2. Install the plugin

Clone, then choose dev or marketplace.

```bash
git clone https://github.com/jakecastillo/the-5-to-9
cd the-5-to-9
```

**Local dev** (run Claude Code with this checkout as a plugin dir):

```bash
claude --plugin-dir "$PWD"
```

**Via marketplace** (inside Claude Code):

```text
/plugin marketplace add jakecastillo/the-5-to-9
/plugin install the-5-to-9@the-5-to-9
```

## 3. First run

```text
/clock-in [goal]
```

That's it. On first clock-in, if no embedded beads DB exists yet but the
committed `.beads/issues.jsonl` is present, the crew runs `bd init` +
`bd import` for you, so `bd ready` works immediately — no manual `bd` setup.
Omit `[goal]` to let the crew infer the smallest defensible goal from the repo.

Peek with `/shift-status`; end with `/clock-out`. For long hands-off runs use a
fresh process per iteration:

```bash
bash scripts/night-shift.sh --max-iterations 30
```

**Driver (optional, TypeScript runtime):** install its deps once.

```bash
cd driver && pnpm install
```

## 4. Per-machine auth (one-time)

Auth is per-machine and lives outside the repo — nothing here ships
credentials.

- **Claude Code:** log in with your Claude account (Max/Pro or API key) the
  way you normally use Claude Code.
- **Codex backend (driver):** run `codex login` once on this machine.

## Guarantees (unchanged on a fresh machine)

- **No-clobber.** The crew never writes to *your* repo's `CLAUDE.md` /
  `AGENTS.md`. Context is additive via hooks/skills. Priority:
  **your repo > The 5 to 9 > defaults.**
- **Irreversible-action gate.** Hard gates fire only on irreversible actions;
  the gate runs on Node and **fails closed** to a bash classifier when Node is
  absent — it never silent-allows.

## Verify

```bash
bash tests/validate-plugin.sh   # must exit 0 (GREEN); CI runs it on push
```
