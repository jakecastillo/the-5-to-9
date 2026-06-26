# the-5-to-9

The standalone terminal app for [The 5 to 9](https://github.com/jakecastillo/the-5-to-9) —
a cross-tool AI night-shift crew. This package is a live, interactive **Ink TUI**
over the existing `driver/` engine: an always-on command bar, a slash-command
palette, and a type-to-filter backlog.
It drives the same shift state, the same [beads](https://github.com/steveyegge/beads)
backlog, and the same irreversible-action gate as the Claude Code plugin — from
your own terminal, no Claude Code required.

## Install

Requires **Node ≥ 20.19**.

```bash
# one-off — launches the interactive TUI
npx the-5-to-9

# or install globally
npm i -g the-5-to-9
the-5-to-9        # → the TUI
```

`the-5-to-9` always boots straight into the TUI. Off a TTY (a pipe or CI) it
degrades to a one-shot, read-only status dump and exits. `--version` and `--help`
are the only flags.

## The command bar

The bottom of the TUI is an always-on input — type and go, the way Claude Code
feels. Two modes, one box:

- **`/` → command palette.** Start with a slash and a fuzzy-ranked menu appears
  (`↑/↓` to pick, `Tab` to complete, `Enter` to run). The vocabulary:

  | Command | What it does |
  | --- | --- |
  | `/clock-in [goal…]` | Open a shift — write state + switch to the `the-5-to-9/shift-<date>` branch (no goal → a prompt modal). |
  | `/clock-out` | Close the shift and show the report. |
  | `/run [--max-iterations n] [--backend claude\|codex\|api] [-K n]` | Start a detached driver run. |
  | `/status` · `/doctor` | Print shift state (read-only) · preflight node/bd/backend. |
  | `/config get\|set <key> [val]` | Read/write config (`backend`, `maxIterations`). |
  | `/gate pending\|approve\|deny <id>` | Resolve a pending irreversible-action consent. |
  | `/filter <text>` · `/follow` · `/clear` | Filter the backlog · toggle stream tail · clear the stream view. |
  | `/help [cmd]` · `/quit` | Show the palette/help · leave the viewer (never kills the driver). |

- **Bare text → live filter.** Type without a slash and the backlog filters as
  you go (id/title/status); `Esc` clears it.

Navigation never steals your keystrokes: `↑/↓` move the selection (or the palette),
`Alt+1/2/3` focus the Status / Backlog / Run-Stream panes, `Tab` cycles them, `?`
(on an empty bar) opens help, and `Ctrl+C` quits. The footer always shows the keys
that are live right now — it's generated from the one keymap table, so it can't lie.

## Configuration

Config lives at `~/.config/the-5-to-9/config.json` (honoring `XDG_CONFIG_HOME`).
Environment variables override the stored config at the read site — e.g.
`FIVE_TO_NINE_BACKEND` wins over `/config set backend`.

## State

Shift state lives under `<repo>/.claude/five-to-nine/` (gitignored) — the same
files the plugin uses, so the TUI and plugin interoperate: `shift.local.md`,
`iteration.count`, `last-gate.txt`, archived shifts under `archive/`.

## Safety

The TUI reuses the plugin's single irreversible-action classifier
(`hooks/irreversible-gate.mjs`): deploys, publishes, force-pushes, remote-data
deletes, and secret destruction/rotation are flagged and surface a blocking,
type-to-confirm gate modal. Everything reversible proceeds.

## Development

```bash
pnpm install          # at the workspace root
pnpm -C cli typecheck  # tsc --noEmit
pnpm -C cli lint       # biome check src
pnpm -C cli test       # vitest run
pnpm -C cli build      # tsup → dist/bin.js
```
