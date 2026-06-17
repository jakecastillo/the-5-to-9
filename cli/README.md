# the-5-to-9

The standalone CLI for [The 5 to 9](https://github.com/jakecastillo/the-5-to-9) —
a cross-tool AI night-shift crew. This package is a pure-Node command line (and,
in a later milestone, an interactive Ink TUI) over the existing `driver/` engine.
It drives the same shift state, the same [beads](https://github.com/steveyegge/beads)
backlog, and the same irreversible-action gate as the Claude Code plugin — from
your own terminal, no Claude Code required.

## Install

Requires **Node ≥ 20.19**.

```bash
# one-off
npx the-5-to-9 status

# or install globally
npm i -g the-5-to-9
```

## Subcommands

| Command | Description |
| --- | --- |
| `the-5-to-9 clock-in [goal...]` | Open a shift: write state, switch to a dedicated `the-5-to-9/shift-<date>` branch. `--no-branch` writes state only. |
| `the-5-to-9 clock-out` | Close the shift, archive state, print the run summary. |
| `the-5-to-9 status` | Print the current shift state + backlog counts (read-only). |
| `the-5-to-9 dashboard` | One-shot dashboard view (`--watch` / interactive TUI lands in a later milestone). |
| `the-5-to-9 run` | Start a detached driver run. Flags: `--backend <claude\|codex\|api>`, `--max-iterations <n>`, `-K <n>`. |
| `the-5-to-9 config get [key]` | Print the stored config (or one key). |
| `the-5-to-9 config set <key> <value>` | Set a config key (`backend`, `maxIterations`). |
| `the-5-to-9 doctor` | Preflight: Node version, `bd`, and the selected backend CLI. |

## Configuration

Config lives at `~/.config/the-5-to-9/config.json` (honoring `XDG_CONFIG_HOME`).
Environment variables override the stored config at the read site — e.g.
`FIVE_TO_NINE_BACKEND` wins over `config set backend`.

## State

Shift state lives under `<repo>/.claude/five-to-nine/` (gitignored) — the same
files the plugin uses, so the CLI and plugin interoperate: `shift.local.md`,
`iteration.count`, `last-gate.txt`, archived shifts under `archive/`.

## Safety

The CLI reuses the plugin's single irreversible-action classifier
(`hooks/irreversible-gate.mjs`): deploys, publishes, force-pushes, remote-data
deletes, and secret destruction/rotation are flagged. Everything reversible
proceeds.

## Development

```bash
pnpm install          # at the workspace root
pnpm -C cli typecheck  # tsc --noEmit
pnpm -C cli lint       # biome check src
pnpm -C cli test       # vitest run
pnpm -C cli build      # tsup → dist/bin.js
```
