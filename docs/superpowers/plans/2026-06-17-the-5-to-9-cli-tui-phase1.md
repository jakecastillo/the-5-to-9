# The 5 to 9 — Standalone CLI/TUI (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `the-5-to-9` as an npm-installable, pure-Node CLI **and** interactive Ink TUI — a standalone surface (separate from the Claude Code plugin) that drives a night shift, built on the existing `driver/` engine.

**Architecture:** A pnpm workspace. `driver/` becomes the engine library; a new `cli/` package (published as `the-5-to-9`, with a `bin`) holds a typed **operations facade** that both scriptable subcommands and the Ink TUI call — no orchestration logic lives in the TUI. The facade ports `setup-shift.sh` / `clock-out.sh` / the dashboard's data-gathering into TS, reuses `driver`'s loop for `run`, and imports `hooks/irreversible-gate.mjs` as the one gate. Milestone A delivers the headless CLI; Milestone B adds the TUI on top of the same facade.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥ 20.19, React 19, ink@^7, @inkjs/ui@^2, ink-testing-library@^4, tsup@^8 (bundle → `bin`), `node:util` `parseArgs`, `node --test` + `tsx` (matches `driver/`), Biome (matches `driver/`).

## Global Constraints

- **Node ≥ 20.19**; set `engines.node` and `.nvmrc`. (verbatim: ecosystem floor for Ink 7 / React 19)
- **ESM only** (`"type": "module"`); `tsconfig` `module`/`moduleResolution` = `NodeNext`.
- **Pin exact-at-plan-time deps:** `ink@^7.0.6`, `@inkjs/ui@^2.0.0`, `ink-testing-library` (latest), `react@^19`, `tsup@^8.5.1`. The Ink render option is **`altScreen`** (not `alternateScreen`) and a Ctrl-C guard is **`exitOnCtrlC: false`** — Task B1 verifies these against the installed README before use.
- **SEE is side-effect-free; reads use fresh processes, never a writer handle** (single-writer Dolt). Mutations go only through facade verbs + the gate.
- **State dir = `${CLAUDE_PROJECT_DIR || git toplevel || cwd}/.claude/five-to-nine`**, gitignored. Read/write the SAME files the plugin uses so they interoperate: `shift.local.md`, `iteration.count`, `last-gate.txt`, `closed.snapshot`.
- **Never touch `main`/`master`**; shift branch is `the-5-to-9/shift-YYYYMMDD`; git ops are best-effort (warn + continue, never block).
- **Bash + the plugin are untouched.** Gate is **surface-only** in Phase 1 (interactive approve is Phase 1b). Non-TTY never shows a modal and never silent-allows.
- **Memory is bounded by construction** (Milestone B): `MAX_STREAM_LINES = 1000` ring buffer, tail-from-offset, deterministic cleanup, single state object.
- The CLI is built/tested **separately** from `validate-plugin.sh`'s bash checks but is wired into it as a new check-group (Task A11).

---

## File Structure

```
package.json                      (NEW) workspace root; private; pnpm
pnpm-workspace.yaml               (NEW) packages: [driver, cli]
.nvmrc                            (NEW) 20.19
driver/                           (exists) engine library — unchanged except it joins the workspace
cli/
  package.json                    (NEW) name "the-5-to-9"; bin; deps driver:workspace:*, ink, @inkjs/ui, react
  tsconfig.json                   (NEW) NodeNext ESM, jsx: react-jsx
  tsup.config.ts                  (NEW) entry src/cli.ts, shebang → dist bin
  biome.json                      (NEW) extends driver style
  src/
    paths.ts                      (NEW) stateDir / stateFile / repoRoot / beadsDir resolution
    state.ts                      (NEW) read shift.local.md frontmatter, iteration.count, last-gate.txt
    beads-read.ts                 (NEW) read-only bd wrappers + readyCount (occurrence-count fix)
    gate.ts                       (NEW) import irreversible-gate.mjs → classifyCommand()
    operations/
      clock-in.ts                 (NEW) port setup-shift.sh
      clock-out.ts                (NEW) port clock-out.sh
      status.ts                   (NEW) state + bd counts
      dashboard-model.ts          (NEW) port shift-dashboard.sh data-gathering
      run.ts                      (NEW) spawn driver detached + journal path
      doctor.ts                   (NEW) preflight node/bd/backend
    cli.ts                        (NEW) #!/usr/bin/env node — parseArgs subcommand dispatch
    tui/                          (Milestone B)
      keymap.ts                   (NEW) single source of truth (key→action→context)
      App.tsx, StatusBar.tsx, BacklogPane.tsx, RunStreamPane.tsx, Footer.tsx,
      ClockInModal.tsx, GateNotice.tsx, HelpOverlay.tsx, ShiftReportView.tsx, StaticStatusDump.tsx
      useShiftPoll.ts             (NEW) single-interval poller hook
      tail.ts                     (NEW) tail-from-offset + ring buffer
  test/                           (NEW) *.test.ts (node --test + tsx); *.test.tsx via ink-testing-library
tests/validate-plugin.sh          (MODIFY) add cli/ check-group (mirror driver block)
tests/check-version-consistency.sh (MODIFY) add cli/package.json
```

---

# Milestone A — CLI core (working headless CLI)

### Task A1: Workspace + cli/ skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `cli/package.json`, `cli/tsconfig.json`, `cli/tsup.config.ts`, `cli/biome.json`
- Test: `cli/test/smoke.test.ts`

**Interfaces:**
- Produces: the `the-5-to-9` package skeleton; `pnpm -C cli run {typecheck,lint,test,build}` all exist.

- [ ] **Step 1: Write root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - driver
  - cli
```
`package.json`:
```json
{ "name": "the-5-to-9-workspace", "private": true, "engines": { "node": ">=20.19" } }
```
`.nvmrc`:
```
20.19
```

- [ ] **Step 2: Write `cli/package.json`**

```json
{
  "name": "the-5-to-9",
  "version": "0.2.0",
  "type": "module",
  "bin": { "the-5-to-9": "./dist/cli.js" },
  "engines": { "node": ">=20.19" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "node --import tsx --test test/*.test.ts test/*.test.tsx",
    "build": "tsup"
  },
  "dependencies": { "driver": "workspace:*", "ink": "^7.0.6", "@inkjs/ui": "^2.0.0", "react": "^19" },
  "devDependencies": { "@biomejs/biome": "^1.9.4", "@types/node": "^22", "@types/react": "^19", "ink-testing-library": "^4", "tsup": "^8.5.1", "tsx": "^4.19", "typescript": "^5.6" }
}
```
> Note: confirm `driver/package.json` has `"name": "driver"` (the grounding shows `@the-5-to-9/driver` — if so, use that name in the `workspace:*` dep and in imports).

- [ ] **Step 3: Write `cli/tsconfig.json`, `cli/tsup.config.ts`, `cli/biome.json`**

`tsconfig.json`: `{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "jsx": "react-jsx", "strict": true, "noEmit": true, "esModuleInterop": true, "skipLibCheck": true }, "include": ["src", "test"] }`
`tsup.config.ts`: `import { defineConfig } from 'tsup'; export default defineConfig({ entry: ['src/cli.ts'], format: ['esm'], clean: true, target: 'node20' });`
`biome.json`: `{ "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json", "extends": ["../driver/biome.json"] }` (or copy driver's rules if extends across packages is unsupported).

- [ ] **Step 4: Write smoke test** — `cli/test/smoke.test.ts`:
```ts
import { test } from 'node:test'; import assert from 'node:assert/strict';
test('smoke', () => { assert.equal(1 + 1, 2); });
```

- [ ] **Step 5: Install + verify** — Run: `pnpm -w install && pnpm -C cli run typecheck && pnpm -C cli run lint && pnpm -C cli test`. Expected: all exit 0; test prints `# pass 1`.

- [ ] **Step 6: Commit** — `git add package.json pnpm-workspace.yaml .nvmrc cli/ && git commit -m "feat(cli): pnpm workspace + the-5-to-9 package skeleton"`

---

### Task A2: Paths + state reader

**Files:** Create `cli/src/paths.ts`, `cli/src/state.ts`; Test `cli/test/state.test.ts`

**Interfaces:**
- Produces:
  - `paths.ts`: `export function stateDir(): string` · `stateFile(): string` · `repoRoot(): string` · `beadsDir(): string`
  - `state.ts`: `export interface ShiftState { active: boolean; goal: string; branch: string; started: string; status: string; maxIterations: string; iteration: number; }` · `export interface GateMarker { color: 'GREEN'|'RED'; count: number; ts: string; } | null` · `export function readShiftState(dir?: string): ShiftState` · `export function readGateMarker(dir?: string): GateMarker | null`

- [ ] **Step 1: Write failing test** — `cli/test/state.test.ts`: write a temp dir with `shift.local.md` (frontmatter: goal/branch/started/engine/status/max_iterations + body), `iteration.count` = `3`, `last-gate.txt` = `GREEN 18 2026-06-17T02:34:05Z`. Assert `readShiftState(tmp)` returns `{active:true, goal:'…', branch:'…', maxIterations:'uncapped', iteration:3}` and `readGateMarker(tmp)` returns `{color:'GREEN', count:18, ts:'2026-06-17T02:34:05Z'}`. Add cases: missing file → `active:false`; malformed `last-gate.txt` (`GREEN` only, empty, `GREEN 18` two-token) → `null` (mirror the bash validate: color ∈ {GREEN,RED} AND count `\d+` AND a third token exists).

- [ ] **Step 2: Run test, verify FAIL** — `pnpm -C cli test`. Expected: FAIL (functions not defined).

- [ ] **Step 3: Implement** — `paths.ts`: `stateDir = join(repoRoot(), '.claude/five-to-nine')`; `repoRoot()` = `process.env.CLAUDE_PROJECT_DIR ?? gitToplevel() ?? process.cwd()` (gitToplevel via `execFileSync('git', ['rev-parse','--show-toplevel'])`, try/catch → null); `beadsDir()` = `join(repoRoot(), '.beads')`. `state.ts`: `readShiftState` reads `stateFile()`; if absent → `{active:false,…''}`; else parse YAML frontmatter between the first two `---` lines with a line-regex `^(\w+):\s*(.*)$` (strip surrounding quotes on the value), read `iteration.count` (parseInt, default 0). `readGateMarker` reads `last-gate.txt`, split on first/second space into `[color, count, ...ts]`; return null unless `/^(GREEN|RED)$/.test(color) && /^\d+$/.test(count) && ts.length>0`.

- [ ] **Step 4: Run test, verify PASS** — `pnpm -C cli test`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add cli/src/paths.ts cli/src/state.ts cli/test/state.test.ts && git commit -m "feat(cli): state-dir resolution + shift-state/gate-marker readers"`

---

### Task A3: Read-only beads adapter

**Files:** Create `cli/src/beads-read.ts`; Test `cli/test/beads-read.test.ts`

**Interfaces:**
- Consumes: `paths.beadsDir()`.
- Produces: `export interface BeadLite { id: string; title: string; status?: string; }` · `export interface BeadsRead { available(): boolean; ready(): Promise<BeadLite[]>; list(status: 'in_progress'|'blocked'): Promise<BeadLite[]>; count(status: string): Promise<number>; readyCount(): Promise<number>; }` · `export function makeBeadsRead(exec?: ExecFn): BeadsRead`

- [ ] **Step 1: Write failing test** — stub a `bd` on `PATH` (a temp executable) replicating `tests/shift-dashboard-test.sh`'s stub: `ready --json` → 2 beads; `list --status=in_progress --json` → 1; `list --status=blocked --json` → 1; `count --status closed` → `5`. Inject an `exec` that resolves these. Assert `ready()` length 2, `count('closed')` = 5, **`readyCount()` = 2** (the occurrence-count fix), and that **no write verb** (`create/update/close/claim/note`) is ever invoked (fail loudly if so). Add a no-bd case: `available()` false → `ready()` = `[]`, `readyCount()` = 0.

- [ ] **Step 2: Run test, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — `makeBeadsRead` uses `driver`'s `realExec` (or injected). `available()` = `command -v bd` succeeds. Before any call, set `BEADS_DIR` in env if `.beads/` exists. Read verbs only: `bd ready --json`, `bd list --status=<X> --json`, `bd count --status <X>`. Parse JSON; `readyCount()` = `(await ready()).length` (NOT `bd count --status ready`, which is always 0). On any failure → graceful default (`[]` / 0). Export an allowlist constant `BD_READ_VERBS = ['ready','list','count','show','blocked']` and assert in code that a built command's verb is in it.

- [ ] **Step 4: Run test, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Commit** — `git add cli/src/beads-read.ts cli/test/beads-read.test.ts && git commit -m "feat(cli): read-only beads adapter (readyCount counts occurrences, never writes)"`

---

### Task A4: Gate facade

**Files:** Create `cli/src/gate.ts`; Test `cli/test/gate.test.ts`

**Interfaces:**
- Consumes: `../../hooks/irreversible-gate.mjs` (`segmentIsIrreversible`, `firstDenySegment`).
- Produces: `export interface GateVerdict { denied: boolean; segment: string | null; }` · `export function classifyCommand(cmd: string): GateVerdict`

- [ ] **Step 1: Write failing test** — assert `classifyCommand('git push origin $(npm publish)').denied === true` (the 13k fix), `classifyCommand('echo $(date)').denied === false`, `classifyCommand('npm test').denied === false`, `classifyCommand('gh release create v1').denied === true`.

- [ ] **Step 2: Run test, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — `import { firstDenySegment } from '../../hooks/irreversible-gate.mjs';` then `const seg = firstDenySegment(cmd); return { denied: seg != null, segment: seg ?? null };`. (Add an `.mjs` ambient module declaration in `cli/src/gate.d.ts` if tsc complains: `declare module '*/irreversible-gate.mjs' { export function firstDenySegment(cmd: string): string | null; export function segmentIsIrreversible(seg: string): boolean; }`.)

- [ ] **Step 4: Run test, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Commit** — `git add cli/src/gate.ts cli/src/gate.d.ts cli/test/gate.test.ts && git commit -m "feat(cli): gate facade reusing irreversible-gate.mjs (one classifier)"`

---

### Task A5: `clockIn` operation (port setup-shift.sh)

**Files:** Create `cli/src/operations/clock-in.ts`; Test `cli/test/clock-in.test.ts`

**Interfaces:**
- Consumes: `paths`, `beads-read.available`.
- Produces: `export interface ClockInResult { branch: string; stateFile: string; warnings: string[]; }` · `export async function clockIn(goal: string, opts?: { noBranch?: boolean }): Promise<ClockInResult>`

- [ ] **Step 1: Write failing test** — in a temp git repo (init + an initial commit), call `clockIn('ship X')`. Assert: `shift.local.md` exists with frontmatter `status: active`, `goal: "ship X"`, `max_iterations: uncapped`, `engine: in-session`, and a body line `ship X`; `iteration.count` == `0`; `closed.snapshot` absent; current branch matches `the-5-to-9/shift-YYYYMMDD`. Add a `--noBranch` case that skips branch ops. Add a case where git fails (point at a non-repo) → returns with a warning, does not throw, state still written.

- [ ] **Step 2: Run test, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — mkdir stateDir; `started = new Date().toISOString()` (truncate ms to match `YYYY-MM-DDTHH:MM:SSZ`); write frontmatter (escape `"` in goal as `\"`); write `iteration.count` = `0`; `rm -f closed.snapshot`. Branch (unless `noBranch`): if current branch already `the-5-to-9/shift-*` keep it; else `git checkout -b the-5-to-9/shift-<YYYYMMDD>` (date from `started`); wrap each git call in try/catch → push to `warnings`, never throw. `bd init` best-effort if `bd` present and `.beads/embeddeddolt` absent.

- [ ] **Step 4: Run test, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Commit** — `git add cli/src/operations/clock-in.ts cli/test/clock-in.test.ts && git commit -m "feat(cli): clockIn operation (ports setup-shift.sh; best-effort git)"`

---

### Task A6: `clockOut` + `status` + `getDashboardModel`

**Files:** Create `cli/src/operations/clock-out.ts`, `status.ts`, `dashboard-model.ts`; Test `cli/test/clock-out.test.ts`, `cli/test/dashboard-model.test.ts`

**Interfaces:**
- Produces:
  - `export interface ShiftReport { goal: string; branch: string; started: string; ended: string; iterations: number; }` · `export async function clockOut(): Promise<ShiftReport>`
  - `export interface StatusView { state: ShiftState; readyCount: number; counts: { closed: number; inProgress: number; blocked: number }; gate: GateMarker | null; }` · `export async function status(): Promise<StatusView>`
  - `export interface DashboardModel extends StatusView { ready: BeadLite[]; inProgress: BeadLite[]; blocked: BeadLite[]; progress: { closed: number; total: number; pct: number }; }` · `export async function getDashboardModel(): Promise<DashboardModel>`

- [ ] **Step 1: Write failing tests** — `clock-out.test.ts`: after a `clockIn` in a temp repo, set `iteration.count`=4, call `clockOut()`; assert it returns `{iterations:4, goal, branch, started, ended}`, archives `shift.local.md` to `.claude/five-to-nine/archive/shift-*.md`, and clears `iteration.count`/`closed.snapshot`; `readShiftState().active` now false. `dashboard-model.test.ts`: with the stub `bd` (closed 5, ready 2, in_progress 1, blocked 1), assert `getDashboardModel()` returns those counts, `progress = {closed:5,total:9,pct:55}`, and the three bead arrays.

- [ ] **Step 2: Run tests, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — `status()` = `readShiftState` + `readGateMarker` + `beads.count` for closed/in_progress/blocked + `beads.readyCount`. `getDashboardModel()` = `status()` + `beads.ready/list` + progress (`total = closed+ready+inProgress+blocked`, `pct = total? round(closed*100/total) : 0`). `clockOut()`: read fields, `ended = now`, `iterations = readShiftState().iteration`, `mkdir archive`, move `shift.local.md` → `archive/shift-<ended-stamp>.md`, clear `iteration.count` + `rm closed.snapshot`, `bd export` best-effort, return report.

- [ ] **Step 4: Run tests, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Commit** — `git add cli/src/operations/{clock-out,status,dashboard-model}.ts cli/test/{clock-out,dashboard-model}.test.ts && git commit -m "feat(cli): clockOut + status + dashboard-model operations"`

---

### Task A7: `run` operation (detached driver) + `doctor`

**Files:** Create `cli/src/operations/run.ts`, `cli/src/operations/doctor.ts`; Test `cli/test/run.test.ts`, `cli/test/doctor.test.ts`

**Interfaces:**
- Produces:
  - `export interface RunHandle { pid: number; journalPath: string; detached: true; }` · `export async function startRun(opts: { maxIterations?: number; backend?: 'claude'|'codex'|'api'; concurrency?: number }): Promise<RunHandle>`
  - `export interface DoctorReport { ok: boolean; checks: { name: string; ok: boolean; detail: string }[]; }` · `export async function doctor(): Promise<DoctorReport>`

- [ ] **Step 1: Write failing tests** — `run.test.ts`: inject a fake spawn; assert `startRun({maxIterations:3, backend:'claude'})` spawns `node` against the driver entry **detached** (`detached:true`, `stdio:'ignore'`, `unref()` called), forwarding `--max-iterations 3 --backend claude`, and returns the journal path under `runs/<branch>/`. `doctor.test.ts`: assert `doctor()` reports node version ≥ 20, bd present/absent, backend CLI present — `ok` true only if required checks pass.

- [ ] **Step 2: Run tests, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — `startRun` resolves the driver entry (`driver/src/main.ts` via its package export or `node --import tsx driver/src/main.ts` in dev / the built path in prod), spawns it `{ detached: true, stdio: 'ignore' }`, `child.unref()`, returns `{ pid, journalPath, detached: true }`. The journal path mirrors `driver`'s `journal`/`RunLog` output location (confirm from `driver/src/journal.ts` / `observability.ts`; if the driver doesn't yet take a stable `--journal <path>`/run-dir flag, add a thin passthrough so the CLI controls it — note in Risks). `doctor`: `process.versions.node` parse, `command -v bd`, `command -v <backend>`.

- [ ] **Step 4: Run tests, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Commit** — `git add cli/src/operations/run.ts cli/src/operations/doctor.ts cli/test/run.test.ts cli/test/doctor.test.ts && git commit -m "feat(cli): startRun (detached driver) + doctor preflight"`

---

### Task A8: CLI entrypoint + subcommand dispatch

**Files:** Create `cli/src/cli.ts`; Test `cli/test/cli.test.ts`

**Interfaces:**
- Consumes: all operations.
- Produces: `export async function runCli(argv: string[], io?: { out: (s: string) => void }): Promise<number>` (exit code). `cli.ts` ends with: `if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await runCli(process.argv.slice(2)));`

- [ ] **Step 1: Write failing test** — call `runCli(['status'], io)` in a temp repo with a stub bd; assert it prints the goal/branch/iteration/gate and counts and returns 0. Assert `runCli(['--help'])` prints usage listing all subcommands and returns 0 without side effects. Assert `runCli(['clock-in','ship X'])` writes state. Assert unknown subcommand → nonzero + usage to stderr.

- [ ] **Step 2: Run test, verify FAIL** — `pnpm -C cli test`. Expected FAIL.

- [ ] **Step 3: Implement** — `#!/usr/bin/env node` first line. Parse with `parseArgs({ args: argv, allowPositionals: true, strict: false, options: { help:{type:'boolean'}, 'max-iterations':{type:'string'}, backend:{type:'string'}, watch:{type:'boolean'}, K:{type:'string'} } })`. `positionals[0]` = subcommand; dispatch: `clock-in`→`clockIn(positionals.slice(1).join(' '))`; `clock-out`→`clockOut()` + print report; `status`→`status()` + print; `run`→`startRun(opts)` + print pid/journal; `dashboard`→(Milestone B; for now render a one-shot text view of `getDashboardModel()`); `config`→get/set the config file; `doctor`→`doctor()`; bare/no subcommand→(Milestone B launches TUI; for now print usage). `--help`/unknown → `usage()`.

- [ ] **Step 4: Run test, verify PASS** — `pnpm -C cli test`. Expected PASS.

- [ ] **Step 5: Build + manual smoke** — Run: `pnpm -C cli build && node cli/dist/cli.js --help`. Expected: usage prints; exit 0.

- [ ] **Step 6: Commit** — `git add cli/src/cli.ts cli/test/cli.test.ts && git commit -m "feat(cli): subcommand dispatch (clock-in/out/status/run/dashboard/config/doctor)"`

---

### Task A9: Config file (`config get|set`)

**Files:** Create `cli/src/config-file.ts`; Test `cli/test/config-file.test.ts`

**Interfaces:** `export interface CliConfig { backend?: 'claude'|'codex'|'api'; maxIterations?: number|'uncapped'; }` · `export function configPath(): string` (`~/.config/the-5-to-9/config.json`) · `export function readConfig(): CliConfig` · `export function setConfig(key: string, value: string): CliConfig` (env still overrides at read sites)

- [ ] **Step 1: Write failing test** — `setConfig('backend','codex')` then `readConfig().backend === 'codex'`; env `FIVE_TO_NINE_BACKEND` overrides at the operation read site. Unknown key → throws with a clear message.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — JSON read/write under `configPath()` (mkdir -p); validate keys against `CliConfig`.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/config-file.ts cli/test/config-file.test.ts && git commit -m "feat(cli): config file (config get/set) replacing FIVE_TO_NINE_* scatter"`

---

### Task A10: README + docs for the standalone CLI

**Files:** Modify `README.md` (add an "Install the CLI" subsection under Ways to run: `npx the-5-to-9` / `npm i -g the-5-to-9`, the subcommands), create `cli/README.md`.

- [ ] **Step 1:** Add the CLI install + subcommand table to `README.md` and a focused `cli/README.md`. (No code; doc step folded into this task.)
- [ ] **Step 2: Commit** — `git add README.md cli/README.md && git commit -m "docs: standalone the-5-to-9 CLI install + subcommands"`

---

### Task A11: Wire cli/ into the gate + version consistency

**Files:** Modify `tests/validate-plugin.sh`, `tests/check-version-consistency.sh`

**Interfaces:** Consumes the driver check-group pattern (lines ~267–280) and the version record list.

- [ ] **Step 1: Add the cli/ check-group** — after the driver check-group in `validate-plugin.sh`, add (mirroring it exactly):
```bash
head_ "cli (the-5-to-9 CLI/TUI)"
if [[ -d "$ROOT/cli" ]] && have node && have pnpm; then
  cli_out="$(cd "$ROOT/cli" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm run typecheck 2>&1 && pnpm run lint 2>&1 && pnpm test 2>&1)"; cli_rc=$?
  if [[ "$cli_rc" -eq 0 ]]; then ok "cli typecheck + lint + tests passed"; else bad "cli checks failed:"; printf '%s\n' "$cli_out" | tail -n 20 | sed 's/^/   /'; fi
elif [[ -d "$ROOT/cli" ]]; then note "cli/ present but node/pnpm absent — skipped (CI installs them)"; else note "no cli/ — skipped"; fi
```
- [ ] **Step 2: Add cli/ to version consistency** — in `tests/check-version-consistency.sh`, after the `driver/package.json` record line, add: `record "cli/package.json" "$(json_version "$ROOT/cli/package.json")"`.
- [ ] **Step 3: Run the full gate** — Run: `bash tests/validate-plugin.sh`. Expected: GREEN, the new "cli" group passes, version consistency passes (all `0.2.0`).
- [ ] **Step 4: Commit** — `git add tests/validate-plugin.sh tests/check-version-consistency.sh && git commit -m "test(gate): wire cli/ into validate-plugin + version-consistency"`

**Milestone A done = a working headless `the-5-to-9` CLI, gate-green.**

---

# Milestone B — Ink TUI

### Task B1: TUI deps spike + minimal App + non-TTY fallback

**Files:** Create `cli/src/tui/App.tsx`, `cli/src/tui/StaticStatusDump.tsx`, `cli/src/tui/launch.ts`; Test `cli/test/tui-launch.test.tsx`

**Interfaces:** `export function launchTui(): void` (guards raw mode) · `export function App(props: { initial?: Partial<AppState> }): JSX.Element`

- [ ] **Step 1: Verify Ink API names** — Run: `pnpm -C cli install && node -e "const fs=require('fs');const r=fs.readFileSync('node_modules/ink/readme.md','utf8');for(const k of ['altScreen','alternateScreen','exitOnCtrlC','isRawModeSupported','useStdout','useFocusManager','Static'])console.log(k, r.includes(k));"`. Expected: confirms the correct render-option name (`altScreen`) and hook names. Use whatever the installed README confirms in all B tasks.
- [ ] **Step 2: Write failing test** — `tui-launch.test.tsx`: with ink-testing-library, `render(<App initial={fixtureActive}/>)`; assert `lastFrame()` contains the goal text. Second case: simulate non-raw stdin (`isRawModeSupported=false`) → `<StaticStatusDump>` renders a plain status dump (no escape codes) and the app does not enter the interactive layout.
- [ ] **Step 3: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 4: Implement** — `launch.ts`: if `useStdin().isRawModeSupported` is false (checked via a tiny probe before render, or render `<StaticStatusDump>`), print the dump and return; else `render(<App/>, { altScreen: true, exitOnCtrlC: false })`. Minimal `App` renders a `<Box flexDirection="column">` with a placeholder StatusBar showing the goal. `StaticStatusDump` prints `status()` fields as plain text honoring `NO_COLOR`.
- [ ] **Step 5: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 6: Commit** — `git add cli/src/tui/ cli/test/tui-launch.test.tsx && git commit -m "feat(tui): Ink app shell + non-TTY StaticStatusDump fallback"`

---

### Task B2: Keymap (single source) + Footer

**Files:** Create `cli/src/tui/keymap.ts`, `cli/src/tui/Footer.tsx`; Test `cli/test/footer.test.tsx`

**Interfaces:** `export type Pane = 'status'|'backlog'|'stream';` · `export interface KeyBinding { key: string; action: string; panes: Pane[]|'global'; }` · `export const KEYMAP: KeyBinding[]` · `export function footerFor(pane: Pane, shiftActive: boolean): string` · `<Footer pane shiftActive/>`

- [ ] **Step 1: Write failing test** — assert `footerFor('backlog', true)` lists exactly the bindings whose `panes` includes `'backlog'` or `'global'`, formatted `key action · …`, and that `<Footer pane="backlog" shiftActive/>`'s `lastFrame()` equals `footerFor('backlog', true)` (footer is generated from the table — they can't drift). Assert action keys `r`/`o` are present only when `shiftActive`.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — `KEYMAP` encodes the spec's table (1/2/3, Tab, j/k, g/G, Enter, /, c, r, f, Ctrl+u/d, o, ?, Esc, q). `footerFor` filters by pane + `shiftActive` gating for r/o; `Footer` renders `footerFor(...)`.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/keymap.ts cli/src/tui/Footer.tsx cli/test/footer.test.tsx && git commit -m "feat(tui): single-source keymap + generated footer"`

---

### Task B3: StatusBar

**Files:** Create `cli/src/tui/StatusBar.tsx`; Test `cli/test/statusbar.test.tsx`

**Interfaces:** `<StatusBar shift={ShiftState} gate={GateMarker|null} running={boolean}/>` (pure function of props).

- [ ] **Step 1: Write failing test** — fixtures: active+GREEN gate → frame contains `goal`, `branch`, `4 / ∞` (when `maxIterations==='uncapped'`), and `GREEN` + `18 groups`; RED gate → contains `RED` (and, with color, the red SGR via a `FORCE_COLOR`-style fixture); no active shift → `no active shift`. Color always paired with a word + glyph.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — render goal/branch/iteration (`iter N / ∞` when uncapped else `N / M`) + gate token (`● GREEN 18 groups · <relative ts>`), color via Ink `<Text color>` gated on `NO_COLOR`.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/StatusBar.tsx cli/test/statusbar.test.tsx && git commit -m "feat(tui): StatusBar (iter N/∞ + color+word+glyph gate token)"`

---

### Task B4: Tail-from-offset + bounded ring buffer

**Files:** Create `cli/src/tui/tail.ts`; Test `cli/test/tail.test.ts`

**Interfaces:** `export const MAX_STREAM_LINES = 1000;` · `export class RingBuffer<T> { constructor(max: number); push(x: T): void; items(): T[]; get length(): number; }` · `export interface JournalTail { lines(): string[]; stop(): void; }` · `export function tailJournal(path: string, onLines: (added: string[]) => void, opts?: { throttleMs?: number; max?: number }): JournalTail`

- [ ] **Step 1: Write failing test** — `RingBuffer(3)`: push 5 → `length===3`, `items()` = last 3. `tailJournal`: write 3 lines to a temp file, start tail (it reads from offset 0), assert `onLines` receives the 3; append 2 more → receives only the 2 new (offset advanced, not re-read); push > `max` total → retained ≤ `max`; `stop()` removes the watcher (assert no further callbacks after stop). Coalescing: rapid appends within `throttleMs` arrive in one batched callback.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — `RingBuffer` with a capped array (shift when over max). `tailJournal`: track byte offset; on `fs.watch` change, read from offset to EOF, split complete lines, advance offset, coalesce on a `throttleMs` (default 200) timer, feed a `RingBuffer(max)`; `stop()` closes the watcher + clears the timer.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/tail.ts cli/test/tail.test.ts && git commit -m "feat(tui): tail-from-offset + bounded ring buffer (memory cap)"`

---

### Task B5: Poller hook (single interval, last-known-good, cleanup)

**Files:** Create `cli/src/tui/useShiftPoll.ts`; Test `cli/test/poll.test.ts`

**Interfaces:** `export function useShiftPoll(intervalMs: number, enabled: boolean): { data: DashboardModel | null; error: string | null }` — internally one `setInterval`, fresh reads via the facade, diff into one state object, keep last-known-good on transient failure, clear interval on unmount.

- [ ] **Step 1: Write failing test** — test the underlying non-React `createPoller(read, intervalMs)` (so it's unit-testable without a renderer): it calls `read` each tick, exposes `data`; when `read` throws, `data` stays last-known-good and `error` is set; `stop()` clears the interval (assert `read` not called after stop). (The hook is a thin wrapper; assert it calls `createPoller` + clears on unmount via an ink-testing-library mount/unmount.)
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — `createPoller` owns the interval; `useShiftPoll` wraps it in `useEffect(() => { const p = createPoller(getDashboardModel, intervalMs); return () => p.stop(); }, [enabled])`. Selection/scroll live in the consuming component's separate state — the poller only updates `data`.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/useShiftPoll.ts cli/test/poll.test.ts && git commit -m "feat(tui): single-interval poller (last-known-good + cleanup)"`

---

### Task B6: BacklogPane (sections, selection preserved, filter)

**Files:** Create `cli/src/tui/BacklogPane.tsx`; Test `cli/test/backlog.test.tsx`

**Interfaces:** `<BacklogPane model={DashboardModel} isActive selectedId scrollOffset filter onSelect/>` — selection/scroll/filter passed in as props (held in App state, separate from polled data).

- [ ] **Step 1: Write failing test** — render with the stub model; assert READY/IN-PROGRESS/BLOCKED sections + bead ids + the progress bar (`closed 7/19 (36%)` style). Drive `stdin.write('\x1B[B')` (down) → `onSelect` fires with the next id. **Selection preserved across a poll:** `rerender(<BacklogPane … model={newModelSameIds} selectedId={kept}/>)` → frame still highlights `kept`. Filter: with `filter='ready'`, only the READY section renders.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — three `<BeadSection>`s of `<BeadRow>` (truncate long titles for display); progress bar from `model.progress`; `useInput` (when `isActive`) maps j/k/g/G to `onSelect`; `/` opens a `<FilterInput>` (filters across all three sections by id/title/state).
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/BacklogPane.tsx cli/test/backlog.test.tsx && git commit -m "feat(tui): BacklogPane (sections, preserved selection, filter)"`

---

### Task B7: RunStreamPane (`<Static>` + live tail + follow)

**Files:** Create `cli/src/tui/RunStreamPane.tsx`; Test `cli/test/stream.test.tsx`

**Interfaces:** `<RunStreamPane lines={string[]} liveLine={string} follow isActive/>` — `lines` come from the ring buffer; `<Static>` renders them once.

- [ ] **Step 1: Write failing test** — render with N lines; assert all appear. Across a `rerender` that appends lines, assert earlier lines are **not re-emitted** (inspect ink-testing-library `frames` — completed lines appear once). Assert the live tail line + spinner render below `<Static>`. `f` toggles follow (assert state via a callback prop).
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — `<Static items={lines}>{(l) => <Text key=…>{l}</Text>}</Static>` + a live `<Text>` for `liveLine` + `<Spinner>` from `@inkjs/ui` when running; `useInput` `f` toggles follow.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/RunStreamPane.tsx cli/test/stream.test.tsx && git commit -m "feat(tui): RunStreamPane (<Static> history + live tail + follow)"`

---

### Task B8: Modals — ClockInModal + GateNotice + HelpOverlay

**Files:** Create `cli/src/tui/ClockInModal.tsx`, `cli/src/tui/GateNotice.tsx`, `cli/src/tui/HelpOverlay.tsx`; Test `cli/test/modals.test.tsx`

**Interfaces:** `<ClockInModal onSubmit(goal) onCancel/>` · `<GateNotice segment category bead onDismiss/>` · `<HelpOverlay pane onClose/>`

- [ ] **Step 1: Write failing test** — ClockInModal: type `'ship X'` + Enter → `onSubmit('ship X')`; Esc → `onCancel`. GateNotice: renders the flagged `segment` + `category`; **traps input** (a nav key like `j` does nothing); `Esc` → `onDismiss` (no side effect); assert it never exposes an "approve" affordance in Phase 1 (surface-only). HelpOverlay: lists `footerFor(pane)`-consistent bindings; Esc closes.
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — ClockInModal uses `@inkjs/ui` `<TextInput>`; GateNotice is a bordered `<Box>` (focus-trap: parent sets other panes inactive) with category + segment + "resolve manually, then re-run" + Esc-dismiss; HelpOverlay renders the keymap for the pane.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/{ClockInModal,GateNotice,HelpOverlay}.tsx cli/test/modals.test.tsx && git commit -m "feat(tui): clock-in/help modals + surface-only gate notice"`

---

### Task B9: App composition — focus, lifecycle, wiring

**Files:** Modify `cli/src/tui/App.tsx`; Create `cli/src/tui/ShiftReportView.tsx`; Test `cli/test/app.test.tsx`

**Interfaces:** `App` owns `{ shift, beads, stream, focusedPane, selectedBeadId, scrollOffset, filter, modal }` + `useShiftPoll` + the tail; `useFocusManager` for Tab; `useInput` dispatches via `KEYMAP`.

- [ ] **Step 1: Write failing test** — mount `<App>`; assert: `Tab`/`1`/`2`/`3` move focus (footer changes per pane); `c` opens ClockInModal and traps nav; `q` with a live shift opens a quit-confirm and does **not** call the run-killer (assert a injected `killRun` is never invoked); a pending-gate fixture renders `<GateNotice>` and freezes background updates (poll paused while modal open); on unmount, the poller interval and journal tail are both stopped (assert injected `stop` spies called).
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — compose StatusBar + (BacklogPane | RunStreamPane) + Footer in a `<Box height={rows-1}>` (rows from `useStdout()`); wire `useShiftPoll` (paused when a modal is open), `tailJournal` for the active run; `r` → `startRun` + focus stream; `o`/`q` → stop poller+tail (NEVER kill the detached driver) → `<ShiftReportView>`; `Ctrl+C` handled via `useApp().exit` after teardown. All keys dispatched through `KEYMAP`.
- [ ] **Step 4: Verify PASS** — `pnpm -C cli test`.
- [ ] **Step 5: Commit** — `git add cli/src/tui/App.tsx cli/src/tui/ShiftReportView.tsx cli/test/app.test.tsx && git commit -m "feat(tui): App composition — focus, detached lifecycle, modal-aware poll"`

---

### Task B10: Wire bare `the-5-to-9` → TUI; final gate

**Files:** Modify `cli/src/cli.ts` (bare invocation + `dashboard`/`dashboard --watch` → `launchTui()`); Test: extend `cli/test/cli.test.ts`

- [ ] **Step 1: Write failing test** — `runCli([])` (bare) with a non-TTY io calls the StaticStatusDump path (not an interactive render) and returns 0; `runCli(['dashboard','--watch'])` resolves to the TUI launcher (assert via an injected launcher spy).
- [ ] **Step 2: Verify FAIL** — `pnpm -C cli test`.
- [ ] **Step 3: Implement** — bare + `dashboard` route to `launchTui()`; keep `dashboard` (no `--watch`) as a one-shot render for pipes.
- [ ] **Step 4: Verify PASS + full gate** — Run: `pnpm -C cli test && bash tests/validate-plugin.sh`. Expected: cli tests pass; gate GREEN.
- [ ] **Step 5: Manual smoke (interactive)** — Run: `pnpm -C cli build && node cli/dist/cli.js` in a real terminal of a repo with a shift; verify panes render, Tab cycles, `q` quits cleanly leaving the alt-screen.
- [ ] **Step 6: Commit** — `git add cli/src/cli.ts cli/test/cli.test.ts && git commit -m "feat(tui): bare the-5-to-9 launches the interactive TUI; gate green"`

**Milestone B done = the interactive TUI on the same facade, gate-green.**

---

## Self-Review (done by author)

**Spec coverage:** workspace+packages → A1; operations facade (clockIn/clockOut/status/runShift/getDashboardModel/doctor) → A5–A7; gate reuse → A4; subcommands → A8; config → A9; TUI panes/keymap/footer → B2–B3,B6–B7; gate-surface notice → B8; live refresh (poll + `<Static>` tail) → B4,B5,B7; **memory management** (ring buffer, tail-from-offset, single state object, deterministic cleanup) → B4,B5,B9 + tests assert the caps; non-TTY fallback → B1; detached lifecycle (q never kills run) → A7,B9; CI wiring + version consistency → A11. ✅ all spec sections map to a task.

**Placeholder scan:** every code step shows real content or an exact signature; the one genuine unknown (Ink render-option/hook names) is resolved by an explicit verify step (B1) before use — not a placeholder. Driver journal-path control is flagged (A7) with a concrete fallback (add a passthrough flag), not left vague.

**Type consistency:** `ShiftState`/`GateMarker` (A2) consumed by `status`/`getDashboardModel` (A6), StatusBar (B3), poller (B5); `BeadLite`/`BeadsRead` (A3) consumed by A6/B6; `DashboardModel` (A6) consumed by B6/B9; `RingBuffer`/`tailJournal` (B4) consumed by B7/B9; `KEYMAP`/`footerFor` (B2) consumed by B6–B9. Names align across tasks.

## Risks / notes carried from the spec

- **Driver journal path:** `startRun` (A7) assumes the driver writes a tailable journal at a path the CLI can predict/control; if it doesn't take a run-dir/journal flag yet, A7 adds a thin passthrough (small driver change — keep it additive, don't refactor the driver).
- **Single-writer Dolt:** the poller (B5) + beads-read (A3) use only the read-verb allowlist with fresh processes — never a held handle.
- **Ink build step / Node ≥ 20** breaks the current "no compiled artifact" convention; isolated to `cli/` + its own gate group now; `AGENTS.md` rewrite is Phase 2.
- **Stream flood / small terminals:** B4 caps memory (`MAX_STREAM_LINES`) and B7 throttles; validate `rows-1` sizing on an 80×24 terminal in the B10 manual smoke.
- **Out of scope (do not build):** interactive gate approve (Phase 1b), retiring bash / repointing the plugin / `AGENTS.md` rewrite (Phase 2), themes, mouse, `:` command bar.
