# Install — The 5 to 9

Get from a fresh machine to a running night shift. A freshly-cloned repo is
`/clock-in`-ready with **zero manual setup steps** — the beads backlog
auto-initializes from the committed export on first clock-in, and all project
context comes from the repo (`README` / `AGENTS.md` / `CLAUDE.md`) + beads, not
from any dev-machine-local state.

## 1. Prerequisites

**Core — to run the plugin (the markdown crew, the primary runtime):**

| Tool | Why | Install hint |
|------|-----|-------------|
| `claude` | the plugin host (Claude Code CLI) | <https://docs.anthropic.com/claude-code> (`npm i -g @anthropic-ai/claude-code`) |
| `bd` (beads) | the backlog + crew memory | <https://github.com/steveyegge/beads> (`brew install steveyegge/tap/beads` or see releases) |
| `git` | branch isolation + the dedicated shift branch | <https://git-scm.com> |
| `node` ≥ 18 *(recommended)* | powers the irreversible-action gate; **falls back to a bash classifier if absent**, so it's recommended, not required | <https://nodejs.org> or `nvm install 20` |

**Optional — only for the experimental TypeScript driver (`driver/`):**

| Tool | Why | Install hint |
|------|-----|-------------|
| `node` ≥ 20 | the driver runs via `tsx` (no build step) | `nvm install 20` |
| `pnpm` | installs the driver's dependencies | `npm i -g pnpm` or <https://pnpm.io/installation> |

You do **not** need Node 20 or pnpm to run the crew — only `claude` + `bd` + `git`.

On a fresh session, the **SessionStart preflight warns once per missing tool**
and never blocks — you can clock in with a partial toolchain (you'll just lose
the feature each missing tool powers).

## 2. Install the plugin

Clone first:

```bash
git clone https://github.com/jakecastillo/the-5-to-9
cd the-5-to-9
```

Then pick **one** of three ways, by what you're doing:

### A. Live side-load — best while developing the plugin

Loads this checkout directly; your edits show up on `/reload-plugins`. Session-only
(a plain `claude` started later won't have it).

```bash
claude --plugin-dir "$PWD"
```

### B. Install from this local checkout — persistent, uses the code on disk

```bash
claude plugin marketplace add "$PWD"          # register this repo as a marketplace
claude plugin install the-5-to-9@the-5-to-9   # install + enable (user scope)
```

> **Snapshot, not a symlink.** Install *copies* the repo into
> `~/.claude/plugins/cache/…` at its current commit. Later edits to your working
> tree won't appear until you bump `version` in `.claude-plugin/plugin.json` and run
> `claude plugin update the-5-to-9@the-5-to-9`. For an edit-reflects-instantly loop,
> use option A instead.

### C. Install from GitHub — for users who just want to run it

```text
/plugin marketplace add jakecastillo/the-5-to-9
/plugin install the-5-to-9@the-5-to-9
```

> This fetches the pushed **default branch** (`main`) — not your local checkout or any
> unpushed branch. The `/plugin …` slash commands open an interactive menu; the
> `claude plugin marketplace add <url> && claude plugin install …` CLI forms do the
> same thing non-interactively if you prefer copy-paste.

### Then: reload so the commands appear

A freshly **installed** plugin (option B or C) does **not** hot-load into a running
session. Run `/reload-plugins`, or quit and relaunch `claude`. (Option A is loaded at
launch, so it's already active.) Confirm it loaded:

```bash
claude plugin list        # → the-5-to-9@the-5-to-9 … ✔ enabled
```

Or type `/` in Claude Code and check that `/clock-in` appears.

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

Confirm the plugin **loaded** (see §2): `claude plugin list` shows it `✔ enabled`,
or `/clock-in` appears under `/` in Claude Code.

To validate the plugin **source** (structure + JSON + frontmatter + `bash -n`):

```bash
bash tests/validate-plugin.sh   # must exit 0 (GREEN); CI runs it on push
```
