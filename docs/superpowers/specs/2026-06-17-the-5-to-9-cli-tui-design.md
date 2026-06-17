# The 5 to 9 — standalone CLI/TUI (pure-Node) — Phase 1 design

**Status:** design (brainstorming output) · **Date:** 2026-06-17 · **Scope:** Phase 1 of a
phased full replacement.

## Summary

Ship `the-5-to-9` as a cohesive, npm-installable **CLI + interactive TUI** — a standalone
surface, separate from the Claude Code plugin — that anyone can `npx the-5-to-9` and use to
drive a night shift. It is pure Node/TypeScript, built on the existing `driver/` runtime.

This is **Phase 1** of a deliberate **phased full replacement** (decision: pure-Node port,
"drop bash", reached in two steps):

- **Phase 1 (this spec):** the npm `the-5-to-9` package — operations facade + scriptable
  subcommands + the Ink TUI. The gate is **surfaced** (shown as a blocking notice); bash
  and the plugin are untouched and keep working.
- **Phase 1b:** the interactive gate **approve** flow (driver pending-consent event + a
  journaled, resumable approval contract + type-to-confirm in the TUI).
- **Phase 2 (separate spec):** repoint the plugin's slash-commands/hooks at the Node CLI,
  retire/shim `scripts/*.sh`, rewrite `AGENTS.md` to TS-first, update SURFACES/docs.

### Locked decisions

| Decision | Choice |
| --- | --- |
| Primary goal | A cohesive CLI/TUI tool, trivial to install and use, standalone from the plugin |
| Interaction model | Hybrid: scriptable subcommands **and** a full-screen interactive TUI; TUI is the flagship |
| Direction | Pure-Node port (drop bash) |
| Port scope | Phased full replacement (Phase 1 alongside bash; Phase 2 retires bash) |
| Gate in Phase 1 | **Surface only** (blocking notice); interactive approve → Phase 1b |
| TUI library | Ink (React-for-terminals) + `@inkjs/ui` |

**Honest costs (named up front):** Phase 1 temporarily runs two orchestration
implementations (the Node CLI and the bash the plugin still uses); Phase 2 removes the
duplication. Ink introduces a TS/JSX **build step** and a Node ≥ 20 runtime dep — this
breaks the current `AGENTS.md` "mostly markdown + JSON + bash, no compiled artifact" rule;
the new package is built and CI-gated separately, and `AGENTS.md` is rewritten in Phase 2.

## Architecture

Turn the repo into a **pnpm workspace** (new root `package.json` + `pnpm-workspace.yaml`):

- **`driver/`** (exists) → promoted to the **engine library**. Its modules already cover
  most of the runtime: `config`, `beads`, `loop`, `orchestrator`, `parallel`, `worktree`,
  `exec`, `journal`, `strategy`, `schema`, `types`, `observability`. The engine never
  imports the TUI.
- **`cli/`** (new) → the published package **`the-5-to-9`** with a `bin`. Depends on
  `driver`. Holds the command parser, the **operations facade**, and the **Ink TUI**.
  Bundled on publish (tsup/esbuild) into one `dist/` so `npx the-5-to-9` works with no
  workspace checkout.

Two packages keep *engine* and *front-end* cleanly separated and independently testable.

### The operations facade (`cli/src/operations.ts`)

One typed module that **both** the subcommands and the TUI call — **no orchestration logic
lives in the TUI**. Each function is the single seam over the engine + ported bash:

- `clockIn(goal, opts)` — write shift state + branch + seed the beads backlog (ports
  `setup-shift.sh`; uses `driver` `config`/`beads`).
- `clockOut()` — end the shift, produce the report (ports `clock-out.sh`).
- `status()` — read shift state + bd status (ports `shift-status` / `--status`).
- `runShift(opts)` — the loop (reuses the `driver` `loop`/`orchestrator`).
- `getDashboardModel()` — the structured data the dashboard renders (ports
  `shift-dashboard.sh`'s **data gathering** into TS; rendering moves to Ink).
- `doctor()` — preflight: Node ≥ 20, `bd`, a backend (claude/codex/api) present.
- The gate classifier is **reused** from `hooks/irreversible-gate.mjs` (already zero-dep
  ESM) — one implementation, imported, never reimplemented.

All reads/writes target the **same `.claude/five-to-nine/` state** (`shift.local.md`,
`iteration.count`, `last-gate.txt`) the plugin uses, so the CLI and the (still-bash) plugin
interoperate during Phase 1.

### CLI surface (subcommands)

`the-5-to-9` (bare → launches the TUI) · `clock-in [goal]` · `clock-out` · `status` ·
`run [--max-iterations N] [--backend claude|codex|api] [-K N]` · `dashboard [--watch]` ·
`config <get|set>` · `doctor`. Arg parsing via `node:util parseArgs` (lean; minimal deps).

### Config

A config file (`~/.config/the-5-to-9/config.json`; env still overrides) replaces scattered
`FIVE_TO_NINE_*` env vars. Extend the driver's `config.ts`.

### Backend / exec

Reuse the driver's `exec.ts`: spawn the `claude`/`codex` CLI (subscription) or hit the API
(`--backend api`). No bash is needed for orchestration; the only child processes are the
LLM backend, `git`, and `bd`.

## TUI design (Ink) — research-grounded

Grounded in lazygit/gitui/lazydocker (panel + contextual-footer model), k9s/gh-dash (live
refresh, filter), Ink internals (`<Static>`, raw mode, flicker), and clig.dev/Charm
(confirm-before-destructive, single-source keymap).

```
┌─ The 5 to 9 ─────────────────────────────────────────── shift: active ⏻ ──┐
│ goal  Ship auth refactor + green CI            branch  shift/auth-refactor  │
│ iter  4 / ∞   ◴ running…        gate  ● GREEN  18 groups · 3m ago           │
├──────────────────────────────┬─────────────────────────────────────────────┤
│ ❷ BACKLOG  closed 7/19 (36%)  │ ❸ RUN STREAM            follow ▸  ◴ iter 4   │
│ [████████░░░░░░░░░░] ready 5   │ 12:31:52 [Dealer] claim t59-4a1 · TDD first │
│ ─ READY ───────────────────   │ 12:33:04 [Floor Auditor] verify vs accept ✓ │
│ ▸ t59-4a1  add token rotation │ 12:33:20 [Cage] close t59-4a1 · commit 9f2a │
│ ─ BLOCKED (red) ───────────   │ 12:33:21 gate ✓ npm test → GREEN 18 groups  │
│   t59-7e0  rotate prod secret │ ◴ iter 4 · Dealer working t59-9c2 …          │
│     ↳ blocked-by t59-4a1      │  (completed lines are <Static> — no reflow)  │
├──────────────────────────────┴─────────────────────────────────────────────┤
│ ❷ ↑/↓ select · enter details · / filter · tab pane │ c clock-in r run o clock-out · ? help · q quit │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Principles (each traceable to a proven tool)

1. **Footer is the manual.** The bottom bar renders only the keys legal in the focused
   pane + current shift state, generated **from the single keymap table** so displayed keys
   can never drift from real bindings (Charm). Zero recall.
2. **Three numbered panes, direct-addressed** (`1` Status · `2` Backlog · `3` Run Stream;
   `Tab`/`Shift+Tab` cycles). lazygit's model; we reject k9s deep breadcrumbs (shallow view
   set). The only push/pop is Backlog → bead detail (`Enter` in, `Esc` out, one crumb).
3. **SEE is provably side-effect-free; ACT is funneled.** Read views issue only
   read-only `bd …--json` / state reads with **fresh read processes, never a writer
   handle** — they cannot contend with the driver's single-writer Dolt write queue. Every
   mutation goes through three labeled keys (`c`/`r`/`o`) and the gate.
4. **Two separate live mechanisms** (below): a bounded **poll** of state, and a bounded
   **tail** of the journal into `<Static>`.
5. **Glanceable status is always-on chrome.** Goal, branch, `iter N / ∞`, and a
   color+word+glyph gate token live in the persistent top bar; only RED/blocked may shout.
6. **Flicker-free; degrade off-TTY.** Alt-screen, root `height = rows−1`, `<Static>` for
   history, ~5 Hz coalesced stream / ~1–2 Hz poll, stable component identity. Guard
   `useStdin().isRawModeSupported`: pipe/CI stdin falls back to a plain status dump and
   refuses the interactive modal.
7. **Three stable universals everywhere:** `?` (help) · `q` (quit; never kills the driver)
   · `Esc` (cancel/close, never a side effect). Color always pairs with a word + glyph
   (survives `NO_COLOR` / color-blindness).
8. **Selection & scroll survive every refresh.** Selected bead id and scroll offset live in
   state separate from polled data, so a background tick re-renders rows without yanking the
   cursor (the lazydocker correctness rule).

### Keymap (single source of truth; drives both `useInput` and the footer/help)

| Key | Action | Context |
| --- | --- | --- |
| `1` / `2` / `3` | Focus Status / Backlog / Run Stream | global |
| `Tab` / `Shift+Tab` | Cycle focus next / prev | global, non-modal |
| `↑`/`↓` or `j`/`k` | Move selection / scroll focused pane | Backlog or Stream |
| `g` / `G` | Top / bottom of list | Backlog |
| `Enter` | Open bead detail (push) / submit in a flow | Backlog / input |
| `/` | Filter backlog in place (id/title/state; across all sections); `Esc` clears | Backlog |
| `c` | Clock-in: open goal text-input modal | non-modal |
| `r` | Run the loop; focus → Run Stream | shift active |
| `f` | Toggle follow/tail (auto-scroll vs pin) | Run Stream |
| `Ctrl+u`/`Ctrl+d` | Page Stream up / down (single meaning) | Run Stream |
| `o` | Clock-out: stop streaming, open report | shift active |
| `?` | Toggle full context keymap overlay | any |
| `Esc` | Close modal / pop detail / clear filter / cancel — never a side effect | any |
| `q` | Quit the viewer (confirm if a shift is live); does **not** kill the driver | top level |
| `Ctrl+C` | Graceful viewer teardown (`exitOnCtrlC:false`); restores alt-screen; never mutates state or aborts the driver | any |

### Core workflows

**Clock-in:** `c` → focus-trapping `TextInput` modal ("Shift goal:"); other panes
`isActive=false`; `Enter` dispatches `clockIn` and **paints goal/branch immediately**
(before bd seed finishes, so it never looks hung); modal closes; Backlog begins polling;
footer brightens `r run`.

**Run & watch:** `r` → `runShift` starts; focus → Run Stream. The poller refreshes the
StatusBar + Backlog counts in place; the tail pushes completed journal lines into
`<Static>` with one live spinner tail line. Selection/scroll preserved across ticks. `f`
toggles follow. A RED gate shows a red first-class status line + flips the StatusBar token
(not a crash). Loop ends on QUEUE-EMPTY / no-progress → status line + "`o` clock-out".

**Gate (Phase 1 — surface only):** when the driver's fail-closed gate stops on an
irreversible segment, the TUI detects the stopped/denied state and raises a **blocking,
focus-trapping notice** naming the exact flagged command, its category
(deploy/publish/force-push/delete-remote/rotate-secrets), and the bead/role that triggered
it. Background redraw freezes so it can't scroll away. Phase 1 says: *"resolve this
manually, then re-run."* `Esc` dismisses (no side effect). **Interactive approve
(type-to-confirm → driver resumes) is Phase 1b** and requires the new driver
pending-consent/resume handshake. Non-TTY never shows a modal and never silent-allows.

**Clock-out:** `o` (or `q` with a live shift → confirm) → stop poller/tail cleanly
(teardown does **not** abort the driver). Render the report (shipped / blocked+why / final
gate / backend mode / gated actions left for a human). On exit, leave the alternate screen
so the report prints to normal scrollback; suggest the next step.

### Live refresh — two bounded mechanisms

1. **Poll** read-only state on one owned `useEffect`+`setInterval` (~1–2 Hz while running,
   none when idle). Each tick re-runs cheap reads (`shift.local.md` frontmatter +
   `iteration.count` + `last-gate.txt`; `bd ready/list/blocked/count --json`) with **fresh
   read processes only**. Diff into one top-level state object; selection/filter/scroll live
   in separate state (no cursor yank, no refetch on keypress). Transient `bd` failure
   self-heals: show "bd unreachable — retrying" and keep last-known-good rather than
   blanking.
2. **Stream** by tailing the driver's append-only journal **from a byte offset** (never
   read the whole file). Completed lines route into Ink `<Static>` (rendered once, never
   repainted); only the in-progress tail line + spinner live in state. Flush to React state
   on a ≥ 200 ms throttle (~5 Hz coalesced) to avoid thrashing Ink's reconciler.

### Component tree

```
render(<App/>, { alternateScreen: true, exitOnCtrlC: false })   // non-TTY → <StaticStatusDump/>
<App>  owns { shift, beads, stream, focusedPane, selectedBeadId, scrollOffset, filter, modal }
       + the single poll interval + the journal tail; useWindowSize() for sizing
  <FullScreenBox height={rows-1} flexDirection="column">
    <StatusBar/>        top chrome; in-place; pure fn of state.shift
    <Box flexDirection="row" flexGrow={1}>
      <BacklogPane/>    useFocus; progress bar + READY/IN-PROGRESS/BLOCKED sections; FilterInput
      <RunStreamPane/>  <Static> completed lines + live tail <Text> + <Spinner>; follow toggle
    </Box>
    <Footer/>           pure fn of (focusedPane, shift.status, modal); rendered FROM the keymap table
  <BeadDetailView/>     overlay on Enter; pure fn of selectedBeadId (bd show --json); Esc pops
  <GateNotice/>         conditional; focus-trap + background freeze (Phase 1 surface; 1b = approve)
  <ClockInModal/>       conditional; @inkjs/ui TextInput focus-trap
  <HelpOverlay/>        conditional on '?'
  <ShiftReportView/>    replaces dashboard on clock-out; printed to normal scrollback after alt-screen exit
```
One keymap table object drives **both** `useInput` dispatch and `<Footer>`/`<HelpOverlay>`
(single source of truth); `useFocusManager` for Tab cycling.

## Memory management (best practice — explicit requirement)

The TUI is long-running and watches a potentially long shift, so memory is bounded **by
construction**. It is a *viewer*: the durable source of truth is the driver's journal on
disk, so the TUI never needs the full history in RAM.

1. **Bounded live-tail ring buffer.** Retain at most `N` recent stream lines (default
   `MAX_STREAM_LINES = 1000`, configurable) in React state. Older lines are **dropped from
   the in-memory array** — not merely hidden. The full transcript stays on disk in the
   journal; "show older" reads from the file on demand, never holds it in RAM.
2. **`<Static>` fed from the capped buffer.** `<Static>` renders completed items once and
   never repaints them, but its `items` array still occupies memory — so it is fed from the
   bounded ring buffer, not an ever-growing list. (In alt-screen there is no terminal
   scrollback, which is exactly why the in-app cap + on-disk source is the right model.)
3. **Tail from offset, streaming.** The journal tail tracks a byte offset and parses only
   newly appended lines (`fs.watch` + incremental read, or a tail helper) — never
   `readFileSync` a growing file. Memory is O(new lines), not O(file size).
4. **Coalesce + drop-to-summary under flood.** Bursts coalesce into one throttled state
   update (≥ 200 ms). If the stream floods past a per-flush cap, collapse to a summary line
   ("…1,240 lines elided — see journal") rather than buffering everything.
5. **Single state object, no snapshot history.** The poller keeps only last-known-good
   state (one object), diffed in place each tick — never an array of historical snapshots.
6. **Windowed lists + truncated strings.** Render only rows that fit the viewport (+ a
   small buffer); hold display-truncated bead titles/lines, fetching full text on demand
   (bead detail reads `bd show` fresh). Guards a pathologically large backlog.
7. **Deterministic cleanup.** Every `useEffect` returns a cleanup that clears its interval,
   closes the file tail / `fs.watch`, removes `stdin` listeners, and unrefs/kills any owned
   child stream. On quit/unmount, all handles are released — no leaks, no dangling watchers.
8. **GC-friendly rendering.** Stable component identity + memoized stable subtrees so ticks
   don't allocate large objects each render (also the anti-flicker path).

Tests assert the caps hold (see Testing): the ring buffer never exceeds `MAX_STREAM_LINES`,
and intervals/tails are cleared on unmount.

## Testing & gate integration

Use **ink-testing-library** so the existing CI gate (`tests/validate-plugin.sh`) covers the
TUI deterministically with no real TTY: `render(<App state=…/>)` → assert `lastFrame()`;
drive `stdin.write` escape sequences (`\r`, `\x1B`, `\t`, `\x1B[A/B`) + `await delay()`.
Core cases: StatusBar GREEN/RED + `4 / ∞` rendering; Backlog selection moves the cursor;
**selection preserved across a poll tick** (rerender, assert unchanged); gate notice traps
input (nav inert, `Esc` dismisses); non-TTY fallback emits the plain dump and refuses the
modal; footer hints exactly match the keymap table; `<Static>` lines appear once across
frames; **memory caps** (ring buffer ≤ `MAX_STREAM_LINES`; intervals/tails cleared on
unmount). A small fixture set of state objects (active / idle / RED-gate / empty-queue /
blocked-with-deps / pending-gate) pins StatusBar + Backlog rendering. The gate's existing
`tests/gate-cases.txt` corpus stays the source of truth for *what* triggers the notice; the
TUI test covers only the notice's behavior.

The `cli/` package gets its own `typecheck` + `lint` + `test` wired into
`validate-plugin.sh` (as `driver/` already is). Plugin + bash stay green and untouched.

## Lifecycle (decision)

The TUI is a **separate viewer/launcher**, not the driver's owner: `run` spawns the driver
as an **independent (detached) process** and the TUI tails its journal. Quitting the TUI
(`q`/`Ctrl+C`) **never kills the run** — it detaches cleanly. This satisfies "cancelling the
viewer must not kill the loop." Active-shift selection comes from `shift.local.md`.

## Resolved smaller decisions

- **Clock-in** = modal `TextInput` (simpler/more discoverable for Phase 1); a `:`
  command-bar is deferred.
- **Filter** scope = across all three backlog sections at once.
- **Journal schema:** the Run Stream tails the driver's existing journal/observability
  output; pinning/adapting the exact line schema (`ts`, `role`, `bead.id`, `action`,
  `outcome`) to a line-oriented tailable form is a Phase-1 implementation task.

## Risks

- **Run Stream depends on a tailable, line-oriented journal.** The driver has `journal.ts`
  / `observability.ts`; if the emitted schema isn't line-oriented, a small adapter is part
  of Phase 1, or the stream renders garbage.
- **Single-writer Dolt contention.** Polling must use an **allowlist of read-only `bd`
  verbs** with fresh processes only; an accidental write verb or held handle risks beads
  corruption.
- **Build step / runtime dep.** Ink needs TS/JSX build + Node ≥ 20 — breaks the current
  "no compiled artifact" convention; isolated to the new package + its own CI gate now,
  `AGENTS.md` rewritten in Phase 2.
- **Small/odd terminals.** `height = rows−1` + grow-column reflow must be validated below
  80×24 (Ink height-flicker, narrow-width collapse → single column).
- **Stream flood.** Even with `<Static>`, a fast journal can flood Ink; the throttle, the
  per-flush cap, and `MAX_STREAM_LINES` must be tuned against a real high-iteration shift.

## YAGNI cuts (Phase 1)

No themes, no mouse, no plugin-management-in-TUI, no `:` command bar, no Windows-without-bash
guarantee (Phase 2), no interactive gate approve (Phase 1b). Just: install easily, see
state, drive a shift, see the gate stop.

## Phasing recap

- **Phase 1 (this spec):** workspace + `cli/` package + operations facade + subcommands +
  Ink TUI (surface-only gate, bounded memory). `npx the-5-to-9` installs and runs. Bash +
  plugin untouched.
- **Phase 1b:** driver pending-consent event + journaled resumable approval + type-to-confirm
  gate modal.
- **Phase 2 (separate spec):** repoint plugin commands/hooks → Node CLI; shim/retire
  `scripts/*.sh`; rewrite `AGENTS.md` TS-first; update SURFACES/docs; the version-consistency
  gate gains the new package.
