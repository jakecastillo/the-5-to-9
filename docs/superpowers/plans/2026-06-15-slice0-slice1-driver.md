# The 5 to 9 Driver — Slice 0 + Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the deterministic TypeScript driver's single-bead vertical — claim → implement → independent verify → serialized close — proving code-driven dispatch, the author≠grader firewall, single-writer beads writes, durable resume, and the gate, all unit-tested with **mocked** external CLIs; plus a Slice-0 owner checklist that pins the live subscription-auth + gate-under-bypass mechanics.

**Architecture:** A thin TS orchestrator (`driver/`) shells out to a pluggable worker-adapter. The driver owns the loop, the write-independent frontier, a single-writer async write queue (the only caller of `bd` writes), a durable journal for crash-safe resume, and a Tier-0 NDJSON run log. Slice 1 wires the single-bead tick with a **mock adapter** (no live model calls); the Claude/Codex adapters are command-builders unit-tested for correct flags and proven live in Slice 0.

**Tech Stack:** Node ≥20 (test runner), TypeScript run via **tsx** (no build step), **pnpm**, **`node:test`**, **biome** (lint+format), zero npm *runtime* deps. External tools (`bd`, `git`, `claude`, `codex`) are shelled out and **injected** so tests use mocks.

**Spec:** `docs/superpowers/specs/2026-06-15-the-5-to-9-sdk-redesign-design.md` (esp. §2.1, §3.2, §4.1, §5.2, §5.6, §7, §8, §10).

**Conventions:** POSIX/Git-Bash-compatible scripts; quote `"${CLAUDE_PLUGIN_ROOT}"`; never rely on the exec bit. The test gate `bash tests/validate-plugin.sh` must exit 0 before any task is "done".

---

## File Structure

```
driver/
  package.json            # name, type:module, engines>=20, scripts (test/lint/typecheck), deps:{} (none)
  tsconfig.json           # ES2022, NodeNext, strict; noEmit (tsx runs sources)
  biome.json              # lint+format config
  .gitignore              # node_modules, runs/
  src/
    types.ts              # shared types: Bead, WorkerSpec, WorkerOutcome, RunConfig, JournalEvent
    schema.ts             # hand-written runtime validator for WorkerOutcome (zero-dep)
    exec.ts               # injectable async exec wrapper (spawn) + ExecFn type
    write-queue.ts        # concurrency-1 promise-chain mutex (single-writer)
    beads.ts              # typed bd-CLI adapter; reads bypass queue, writes go through it
    journal.ts            # append-only fsync JSONL journal + replay + idempotency/outbox
    worktree.ts           # native `git worktree add`/remove + lease
    adapters/
      adapter.ts          # WorkerAdapter interface + disallowedTools deny-rules constant
      mock.ts             # MockAdapter for tests (scripted outcomes)
      claude.ts           # buildClaudeArgs() command-builder (exec mocked in tests)
    config.ts             # parse/validate knobs; credential-mode confirm; API-key scrub; banner
    observability.ts      # Tier-0 NDJSON run log + budget ledger/breaker
    orchestrator.ts       # the single-bead tick (claim→dispatch→gate→audit→close) + resume
    main.ts               # CLI entry (parse argv → run)
  test/
    schema.test.ts  write-queue.test.ts  beads.test.ts  journal.test.ts
    worktree.test.ts  adapters.test.ts  config.test.ts  observability.test.ts
    orchestrator.test.ts
scripts/
  launch-driver.sh        # POSIX launcher invoked by /clock-in
docs/superpowers/spikes/
  2026-06-15-slice0-spike.md   # owner fills in live-credential findings (Slice 0)
```

`validate-plugin.sh` gains a step that runs the driver's typecheck + lint + tests.

---

## Slice 0 — Spike (owner-run; de-risk live mechanics)

Slice 0 is **verification on the owner's machine/accounts**, not autonomous code. It pins the
flags/auth the adapters will hard-code. Capture every result in
`docs/superpowers/spikes/2026-06-15-slice0-spike.md`.

### Task S0.1: Create the spike notes file

**Files:** Create `docs/superpowers/spikes/2026-06-15-slice0-spike.md`

- [ ] **Step 1: Create the notes file with the checklist below**

```markdown
# Slice 0 Spike — live mechanics (owner-run) — 2026-06-15

Goal: pin the exact flags/auth the adapters will use, and confirm the gate fires under bypass.
Fill each result in. "PIN:" lines become constants in the adapters.

## A. Claude on Max (subscription, ToS-safe)
- [ ] `claude setup-token` → generates a long-lived OAuth token. Record env var name (expected `CLAUDE_CODE_OAUTH_TOKEN`) and expiry. RESULT:
- [ ] `claude -p "say hi" --output-format json` with that token (no ANTHROPIC_API_KEY in env) → confirm JSON shape (fields: result/total_cost_usd/usage). PIN the field paths. RESULT:
- [ ] Confirm a worker can select model + role: `claude -p --model sonnet --append-system-prompt "<role charter>" --output-format json`. PIN flag names. RESULT:
- [ ] Structured output: does `--output-format json` reliably wrap the final message as JSON? Note any `--include-partial-messages`/schema flags. RESULT:

## B. Codex on the ChatGPT plan (subscription)
- [ ] `codex login --device-auth` (or seed `~/.codex/auth.json`) → confirm plan auth (not API key). RESULT:
- [ ] `codex exec --json --output-schema <schema.json> --sandbox workspace-write --cd <repo> "<task>"` → confirm NDJSON event stream + final structured result. PIN flags. RESULT:
- [ ] Confirm ToS reality: do NOT run two `codex exec` concurrently on one login. Note observed behavior. RESULT:

## C. The gate under bypass (CRITICAL)
- [ ] In a throwaway repo with this plugin installed, run a worker under `--dangerously-skip-permissions` that attempts `git push --force` → confirm the PreToolUse `irreversible-gate.mjs` hook BLOCKS it. RESULT:
- [ ] Confirm a `disallowedTools` deny-rule (e.g. `--disallowedTools "Bash(bd create*)"`) blocks a `bd create` attempt under bypass. PIN the exact deny-rule syntax. RESULT:

## D. Overnight auth stability
- [ ] Leave a token-authed `claude -p` smoke loop running ~6–8h (or re-run after a long gap) → confirm the token did not expire/log out mid-run. RESULT:

## Decisions captured (fill the PINs the adapters will use)
- Claude worker invocation: PIN: `claude -p ...`
- Codex worker invocation: PIN: `codex exec ...`
- Deny-rule syntax: PIN:
- JSON result field paths (cost/usage/result): PIN:
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/spikes/2026-06-15-slice0-spike.md
git commit -m "docs(spike): Slice 0 owner checklist for live subscription-auth + gate-under-bypass"
```

### Task S0.2: Smoke script for the gate-under-bypass check (owner runs it)

**Files:** Create `scripts/spike-gate-smoke.sh`

- [ ] **Step 1: Write the smoke script**

```bash
#!/usr/bin/env bash
# Slice 0 smoke: prove the irreversible-gate PreToolUse hook fires under bypass.
# Owner runs this in a throwaway git repo with The 5 to 9 installed. Reversible only.
set -uo pipefail
echo "This asks a bypass-permissions worker to attempt 'git push --force'."
echo "EXPECT: the irreversible-gate hook BLOCKS it (no force-push happens)."
read -r -p "Run now? [y/N] " ans; [[ "$ans" == "y" ]] || exit 0
claude -p "Run exactly: git push --force origin HEAD. Do nothing else." \
  --dangerously-skip-permissions --output-format json \
  || echo "Worker exited nonzero (a block is acceptable/expected)."
echo "Now verify in the repo: 'git reflog' shows NO force-push occurred."
```

- [ ] **Step 2: Verify bash syntax**

Run: `bash -n scripts/spike-gate-smoke.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/spike-gate-smoke.sh
git commit -m "chore(spike): gate-under-bypass smoke script for Slice 0"
```

> **Slice 0 exit (owner):** the spike notes file has every RESULT + PIN filled, and the gate
> smoke confirms a block. These PINs feed Task 7 (the Claude adapter). The autonomous Slice 1
> below does **not** block on Slice 0 — it uses a mock adapter.

---

## Slice 1 — Single-bead vertical (autonomous; mock adapter)

### Task 1: Scaffold the `driver/` toolchain

**Files:** Create `driver/package.json`, `driver/tsconfig.json`, `driver/biome.json`, `driver/.gitignore`, `driver/test/smoke.test.ts`

- [ ] **Step 1: Write a failing smoke test**

`driver/test/smoke.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('toolchain runs TS tests', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Write package.json, tsconfig, biome, .gitignore**

`driver/package.json`:
```json
{
  "name": "@the-5-to-9/driver",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "biome check src test",
    "test": "node --import tsx --test \"test/**/*.test.ts\""
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "@biomejs/biome": "^1.8.0"
  },
  "dependencies": {}
}
```

`driver/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`driver/biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.8.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 }
}
```

`driver/.gitignore`:
```
node_modules/
runs/
*.tsbuildinfo
```

- [ ] **Step 3: Install and run the smoke test**

Run: `cd driver && pnpm install && pnpm test`
Expected: 1 test passes (`toolchain runs TS tests`).

- [ ] **Step 4: Commit**

```bash
git add driver/
git commit -m "feat(driver): scaffold TS toolchain (tsx, node:test, biome, zero runtime deps)"
```

### Task 2: Shared types + WorkerOutcome schema validator

**Files:** Create `driver/src/types.ts`, `driver/src/schema.ts`, `driver/test/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/schema.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkerOutcome } from '../src/schema.ts';

test('accepts a valid worker outcome', () => {
  const r = validateWorkerOutcome({
    beadId: 'b1', role: 'dealer', status: 'done',
    summary: 'implemented', filesTouched: ['a.ts'], costUsd: 0.01,
  });
  assert.equal(r.ok, true);
});

test('rejects an outcome missing required fields', () => {
  const r = validateWorkerOutcome({ beadId: 'b1' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /role|status/);
});

test('rejects an unknown status', () => {
  const r = validateWorkerOutcome({ beadId: 'b1', role: 'dealer', status: 'maybe', summary: 's', filesTouched: [], costUsd: 0 });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (`Cannot find module '../src/schema.ts'`).

- [ ] **Step 3: Write types.ts and schema.ts**

`driver/src/types.ts`:
```typescript
export type Role = 'owner' | 'pitboss' | 'dealer' | 'auditor' | 'eye' | 'cage' | 'floorman';

export interface Bead {
  id: string;
  status: string;
  inScopeDirs?: string[]; // §5.2 touch-set for write-independence
}

export interface WorkerSpec {
  beadId: string;
  role: Role;
  systemPrompt: string;
  task: string;
  model: string;
  allowedTools: string[];
  disallowedTools: string[];
  worktree: string;
}

export type WorkerStatus = 'done' | 'failed' | 'blocked';

export interface WorkerOutcome {
  beadId: string;
  role: Role;
  status: WorkerStatus;
  summary: string;
  filesTouched: string[];
  costUsd: number;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
```

`driver/src/schema.ts`:
```typescript
import type { WorkerOutcome, Validated } from './types.ts';

const ROLES = new Set(['owner', 'pitboss', 'dealer', 'auditor', 'eye', 'cage', 'floorman']);
const STATUSES = new Set(['done', 'failed', 'blocked']);

export function validateWorkerOutcome(x: unknown): Validated<WorkerOutcome> {
  if (typeof x !== 'object' || x === null) return { ok: false, error: 'not an object' };
  const o = x as Record<string, unknown>;
  if (typeof o.beadId !== 'string' || !o.beadId) return { ok: false, error: 'beadId required' };
  if (typeof o.role !== 'string' || !ROLES.has(o.role)) return { ok: false, error: 'invalid role' };
  if (typeof o.status !== 'string' || !STATUSES.has(o.status)) return { ok: false, error: 'invalid status' };
  if (typeof o.summary !== 'string') return { ok: false, error: 'summary required' };
  if (!Array.isArray(o.filesTouched) || !o.filesTouched.every((f) => typeof f === 'string'))
    return { ok: false, error: 'filesTouched must be string[]' };
  if (typeof o.costUsd !== 'number' || Number.isNaN(o.costUsd)) return { ok: false, error: 'costUsd must be a number' };
  return { ok: true, value: o as unknown as WorkerOutcome };
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/types.ts driver/src/schema.ts driver/test/schema.test.ts
git commit -m "feat(driver): shared types + zero-dep WorkerOutcome validator"
```

### Task 3: Single-writer write queue (concurrency-1 mutex)

**Files:** Create `driver/src/write-queue.ts`, `driver/test/write-queue.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/write-queue.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WriteQueue } from '../src/write-queue.ts';

test('serializes writes — no two run concurrently', async () => {
  const q = new WriteQueue();
  let active = 0;
  let maxActive = 0;
  const job = () => async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await Promise.all([q.run(job()), q.run(job()), q.run(job())]);
  assert.equal(maxActive, 1);
});

test('preserves FIFO order and returns values', async () => {
  const q = new WriteQueue();
  const out: number[] = [];
  const results = await Promise.all([1, 2, 3].map((n) => q.run(async () => { out.push(n); return n * 10; })));
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(results, [10, 20, 30]);
});

test('a rejecting job does not break the queue', async () => {
  const q = new WriteQueue();
  await assert.rejects(q.run(async () => { throw new Error('boom'); }));
  assert.equal(await q.run(async () => 'ok'), 'ok');
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (`Cannot find module '../src/write-queue.ts'`).

- [ ] **Step 3: Write write-queue.ts**

`driver/src/write-queue.ts`:
```typescript
/** Concurrency-1 FIFO mutex: the single-writer guarantee (§3.2). */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    // keep the chain alive even if a job rejects, without unhandled rejections
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: write-queue tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/write-queue.ts driver/test/write-queue.test.ts
git commit -m "feat(driver): single-writer concurrency-1 write queue"
```

### Task 4: Injectable exec wrapper + typed bd-CLI adapter

**Files:** Create `driver/src/exec.ts`, `driver/src/beads.ts`, `driver/test/beads.test.ts`

- [ ] **Step 1: Write the failing test (mock exec)**

`driver/test/beads.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Beads } from '../src/beads.ts';
import { WriteQueue } from '../src/write-queue.ts';
import type { ExecFn } from '../src/exec.ts';

function mockExec(scripts: Record<string, { stdout?: string; code?: number }>): { fn: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    const match = Object.entries(scripts).find(([k]) => key.startsWith(k));
    const r = match ? match[1] : { stdout: '', code: 0 };
    if ((r.code ?? 0) !== 0) throw new Error(`exit ${r.code}: ${key}`);
    return { stdout: r.stdout ?? '', stderr: '', code: 0 };
  };
  return { fn, calls };
}

test('ready() parses --json output', async () => {
  const { fn } = mockExec({ 'bd ready': { stdout: JSON.stringify([{ id: 'b1', status: 'open' }]) } });
  const beads = new Beads(fn, new WriteQueue());
  const ready = await beads.ready();
  assert.equal(ready[0].id, 'b1');
});

test('close() routes through the write queue and shells bd close', async () => {
  const { fn, calls } = mockExec({ 'bd close': { stdout: '{}' } });
  const beads = new Beads(fn, new WriteQueue());
  await beads.close('b1', 'done');
  assert.ok(calls.some((c) => c.startsWith('bd close b1')));
});

test('nonzero exit on a write surfaces as an error', async () => {
  const { fn } = mockExec({ 'bd close': { code: 1 } });
  const beads = new Beads(fn, new WriteQueue());
  await assert.rejects(beads.close('b1', 'done'));
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing `exec.ts`/`beads.ts`).

- [ ] **Step 3: Write exec.ts and beads.ts**

`driver/src/exec.ts`:
```typescript
import { spawn } from 'node:child_process';

export interface ExecResult { stdout: string; stderr: string; code: number; }
export type ExecFn = (cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<ExecResult>;

/** Real exec; tests inject a mock ExecFn instead. */
export const realExec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code: 0 });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
```

`driver/src/beads.ts`:
```typescript
import type { ExecFn } from './exec.ts';
import type { Bead } from './types.ts';
import type { WriteQueue } from './write-queue.ts';

/** Typed bd-CLI adapter. Reads run directly; ALL writes funnel through the WriteQueue (§3.2/§8). */
export class Beads {
  constructor(private exec: ExecFn, private queue: WriteQueue, private cwd?: string) {}

  private async json<T>(args: string[]): Promise<T> {
    const { stdout } = await this.exec('bd', [...args, '--json'], { cwd: this.cwd });
    return JSON.parse(stdout || 'null') as T;
  }

  // ---- reads (bypass the queue) ----
  ready(): Promise<Bead[]> { return this.json<Bead[]>(['ready']).then((r) => r ?? []); }
  show(id: string): Promise<Bead> { return this.json<Bead>(['show', id]); }

  // ---- writes (serialized through the queue; the ONLY write path) ----
  create(args: string[]): Promise<void> {
    return this.queue.run(async () => { await this.exec('bd', ['create', ...args], { cwd: this.cwd }); });
  }
  claim(id: string): Promise<void> {
    return this.queue.run(async () => { await this.exec('bd', ['update', id, '--claim'], { cwd: this.cwd }); });
  }
  note(id: string, text: string): Promise<void> {
    return this.queue.run(async () => { await this.exec('bd', ['note', id, text], { cwd: this.cwd }); });
  }
  close(id: string, reason: string): Promise<void> {
    return this.queue.run(async () => { await this.exec('bd', ['close', id, '--reason', reason], { cwd: this.cwd }); });
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: beads tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/exec.ts driver/src/beads.ts driver/test/beads.test.ts
git commit -m "feat(driver): injectable exec + typed bd-CLI adapter (writes via the queue)"
```

### Task 5: Durable journal (append-only fsync + replay + idempotency)

**Files:** Create `driver/src/journal.ts`, `driver/test/journal.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/journal.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../src/journal.ts';

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'f9-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('append then replay reconstructs events in order', async () => {
  await withDir(async (dir) => {
    const j = new Journal(join(dir, 'journal.jsonl'));
    await j.append({ type: 'claim', beadId: 'b1' });
    await j.append({ type: 'close', beadId: 'b1' });
    const events = await Journal.replay(join(dir, 'journal.jsonl'));
    assert.deepEqual(events.map((e) => e.type), ['claim', 'close']);
  });
});

test('hasDone() makes close idempotent across a simulated crash', async () => {
  await withDir(async (dir) => {
    const path = join(dir, 'journal.jsonl');
    const j1 = new Journal(path);
    await j1.append({ type: 'close', beadId: 'b1' });
    // simulate restart: new Journal over the same file
    const events = await Journal.replay(path);
    const j2 = new Journal(path, events);
    assert.equal(j2.hasDone('close', 'b1'), true);
    assert.equal(j2.hasDone('close', 'b2'), false);
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing `journal.ts`).

- [ ] **Step 3: Write journal.ts**

`driver/src/journal.ts`:
```typescript
import { open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface JournalEvent {
  type: 'tick' | 'claim' | 'dispatch' | 'outcome' | 'merge' | 'close' | 'cap' | 'gate';
  beadId?: string;
  [k: string]: unknown;
}

/** Append-only, fsync'd JSONL journal for crash-safe, idempotent resume (§5.6). */
export class Journal {
  private done = new Set<string>();

  constructor(private path: string, replayed: JournalEvent[] = []) {
    mkdirSync(dirname(path), { recursive: true });
    for (const e of replayed) this.index(e);
  }

  private key(type: string, beadId?: string): string { return `${type}:${beadId ?? ''}`; }
  private index(e: JournalEvent) { if (e.beadId) this.done.add(this.key(e.type, e.beadId)); }

  /** True if this (type, beadId) effect was already journaled (exactly-once guard). */
  hasDone(type: JournalEvent['type'], beadId: string): boolean { return this.done.has(this.key(type, beadId)); }

  async append(e: JournalEvent): Promise<void> {
    const fh = await open(this.path, 'a');
    try {
      await fh.write(`${JSON.stringify(e)}\n`);
      await fh.sync(); // fsync: durable before the effect runs
    } finally {
      await fh.close();
    }
    this.index(e);
  }

  static async replay(path: string): Promise<JournalEvent[]> {
    let raw = '';
    try { raw = await readFile(path, 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalEvent);
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: journal tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/journal.ts driver/test/journal.test.ts
git commit -m "feat(driver): durable fsync journal with replay + idempotency keys"
```

### Task 6: Worker-adapter interface, deny-rules, mock + Claude command-builder

**Files:** Create `driver/src/adapters/adapter.ts`, `driver/src/adapters/mock.ts`, `driver/src/adapters/claude.ts`, `driver/test/adapters.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/adapters.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BD_WRITE_DENY, IRREVERSIBLE_DENY } from '../src/adapters/adapter.ts';
import { MockAdapter } from '../src/adapters/mock.ts';
import { buildClaudeArgs } from '../src/adapters/claude.ts';
import type { WorkerSpec } from '../src/types.ts';

const spec: WorkerSpec = {
  beadId: 'b1', role: 'dealer', systemPrompt: 'You are a Dealer.', task: 'do it',
  model: 'sonnet', allowedTools: ['Read', 'Edit', 'Bash'],
  disallowedTools: [...BD_WRITE_DENY, ...IRREVERSIBLE_DENY], worktree: '/tmp/wt',
};

test('deny-rules include bd writes and force-push', () => {
  assert.ok(BD_WRITE_DENY.some((r) => r.includes('bd create')));
  assert.ok(IRREVERSIBLE_DENY.some((r) => r.includes('push') && r.includes('force')));
});

test('Claude args carry model, output-format json, and disallowedTools', () => {
  const args = buildClaudeArgs(spec);
  assert.ok(args.includes('--model') && args.includes('sonnet'));
  assert.ok(args.join(' ').includes('--output-format json'));
  assert.ok(args.join(' ').includes('--disallowedTools'));
  assert.ok(args.join(' ').includes('Bash(bd create*)'));
});

test('MockAdapter returns the scripted outcome', async () => {
  const m = new MockAdapter({ b1: { beadId: 'b1', role: 'dealer', status: 'done', summary: 'ok', filesTouched: ['a.ts'], costUsd: 0.02 } });
  const out = await m.run(spec);
  assert.equal(out.status, 'done');
  assert.equal(out.costUsd, 0.02);
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing adapter modules).

- [ ] **Step 3: Write the adapter modules**

`driver/src/adapters/adapter.ts`:
```typescript
import type { WorkerSpec, WorkerOutcome } from '../types.ts';

/** Deny-rules that FIRE under bypassPermissions (§4.1/§7). allowedTools does NOT, so these matter. */
export const BD_WRITE_DENY = [
  'Bash(bd create*)', 'Bash(bd update*)', 'Bash(bd close*)', 'Bash(bd claim*)', 'Bash(bd note*)', 'Bash(bd dep*)',
];
export const IRREVERSIBLE_DENY = [
  'Bash(git push --force*)', 'Bash(git push -f*)',
];

export interface WorkerAdapter {
  run(spec: WorkerSpec): Promise<WorkerOutcome>;
}
```

`driver/src/adapters/mock.ts`:
```typescript
import type { WorkerAdapter } from './adapter.ts';
import type { WorkerSpec, WorkerOutcome } from '../types.ts';

/** Test adapter: returns scripted outcomes by beadId. No model calls. */
export class MockAdapter implements WorkerAdapter {
  constructor(private scripts: Record<string, WorkerOutcome>) {}
  async run(spec: WorkerSpec): Promise<WorkerOutcome> {
    const out = this.scripts[spec.beadId];
    if (!out) throw new Error(`MockAdapter: no script for ${spec.beadId}`);
    return { ...out, role: spec.role };
  }
}
```

`driver/src/adapters/claude.ts`:
```typescript
import type { WorkerAdapter } from './adapter.ts';
import type { WorkerSpec, WorkerOutcome } from '../types.ts';
import type { ExecFn } from '../exec.ts';
import { validateWorkerOutcome } from '../schema.ts';

/** Build `claude -p` args for a worker. Flags are PINNED from the Slice-0 spike. */
export function buildClaudeArgs(spec: WorkerSpec): string[] {
  return [
    '-p', spec.task,
    '--model', spec.model,
    '--append-system-prompt', spec.systemPrompt,
    '--output-format', 'json',
    '--permission-mode', 'dontAsk',
    '--allowedTools', spec.allowedTools.join(','),
    '--disallowedTools', spec.disallowedTools.join(','),
    '--add-dir', spec.worktree,
  ];
}

/** Real Claude adapter (subscription via CLAUDE_CODE_OAUTH_TOKEN). Exec is injected for tests. */
export class ClaudeAdapter implements WorkerAdapter {
  constructor(private exec: ExecFn) {}
  async run(spec: WorkerSpec): Promise<WorkerOutcome> {
    const { stdout } = await this.exec('claude', buildClaudeArgs(spec), { cwd: spec.worktree });
    const parsed = JSON.parse(stdout);
    // The worker is prompted to emit a WorkerOutcome JSON as its final result.
    const payload = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result ?? parsed;
    const v = validateWorkerOutcome({ ...payload, costUsd: parsed.total_cost_usd ?? payload.costUsd ?? 0 });
    if (!v.ok) throw new Error(`worker outcome invalid: ${v.error}`);
    return v.value;
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: adapters tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/adapters/ driver/test/adapters.test.ts
git commit -m "feat(driver): worker-adapter interface, bypass-safe deny-rules, mock + Claude builder"
```

### Task 7: Config, credential-mode safety, budget banner

**Files:** Create `driver/src/config.ts`, `driver/test/config.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/config.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, scrubbedEnv } from '../src/config.ts';

test('rejects an unconfirmed credential mode', () => {
  assert.throws(() => resolveConfig({ backend: undefined, goal: 'g' }), /credential mode/i);
});

test('defaults to subscription-first serialized (K=1) for claude/codex', () => {
  const c = resolveConfig({ backend: 'codex', goal: 'g' });
  assert.equal(c.concurrency, 1);
  assert.equal(c.credentialMode, 'subscription');
});

test('scrubbedEnv removes ANTHROPIC_API_KEY unless the api backend is chosen', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-x', PATH: '/bin' };
  assert.equal(scrubbedEnv('codex', env).ANTHROPIC_API_KEY, undefined);
  assert.equal(scrubbedEnv('api', env).ANTHROPIC_API_KEY, 'sk-x');
});

test('budget banner names backend + mode + caps', () => {
  const c = resolveConfig({ backend: 'codex', goal: 'g', budgetUsd: 5 });
  assert.match(c.banner, /codex/);
  assert.match(c.banner, /subscription/);
  assert.match(c.banner, /\$5/);
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing `config.ts`).

- [ ] **Step 3: Write config.ts**

`driver/src/config.ts`:
```typescript
export type Backend = 'claude' | 'codex' | 'api';
export type CredentialMode = 'subscription' | 'metered-api';

export interface RawArgs {
  backend?: Backend;
  goal: string;
  maxIterations?: number;
  noProgressWindow?: number;
  concurrency?: number;
  budgetUsd?: number;
  budgetTokens?: number;
}

export interface RunConfig {
  backend: Backend;
  credentialMode: CredentialMode;
  goal: string;
  maxIterations: number;
  noProgressWindow: number;
  concurrency: number;
  budgetUsd: number;
  budgetTokens: number;
  banner: string;
}

const SUBSCRIPTION: Record<Backend, boolean> = { claude: true, codex: true, api: false };

/** Remove a stray ANTHROPIC_API_KEY unless the api backend was explicitly chosen (§2.1 safety). */
export function scrubbedEnv(backend: Backend, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (backend === 'api') return { ...env };
  const { ANTHROPIC_API_KEY, ...rest } = env;
  return rest;
}

export function resolveConfig(a: RawArgs): RunConfig {
  if (!a.backend) throw new Error('credential mode unconfirmed: pass --backend claude|codex|api');
  const credentialMode: CredentialMode = SUBSCRIPTION[a.backend] ? 'subscription' : 'metered-api';
  // subscription-first SERIALIZED: K>1 only allowed on the api backend (§2.1)
  const concurrency = a.backend === 'api' ? (a.concurrency ?? 2) : 1;
  const maxIterations = a.maxIterations ?? 30;
  const noProgressWindow = a.noProgressWindow ?? 3;
  const budgetUsd = a.budgetUsd ?? (credentialMode === 'metered-api' ? 5 : 0);
  const budgetTokens = a.budgetTokens ?? 0;
  if (maxIterations < 1) throw new Error('--max-iterations must be >= 1');
  const banner =
    `This shift bills ${a.backend} as ${credentialMode}; ` +
    `K=${concurrency}, cap=${maxIterations}, budget<=$${budgetUsd}/${budgetTokens || '∞'} tokens.`;
  return { backend: a.backend, credentialMode, goal: a.goal, maxIterations, noProgressWindow, concurrency, budgetUsd, budgetTokens, banner };
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: config tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/config.ts driver/test/config.test.ts
git commit -m "feat(driver): config + credential-mode safety, api-key scrub, budget banner"
```

### Task 8: Tier-0 observability — NDJSON run log + budget breaker

**Files:** Create `driver/src/observability.ts`, `driver/test/observability.test.ts`

- [ ] **Step 1: Write the failing test**

`driver/test/observability.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunLog, BudgetLedger } from '../src/observability.ts';

test('RunLog writes one NDJSON record per event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9log-'));
  try {
    const log = new RunLog(join(dir, 'events.jsonl'));
    await log.write({ kind: 'tick', n: 1 });
    await log.write({ kind: 'close', beadId: 'b1' });
    const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).kind, 'tick');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('BudgetLedger trips the breaker when cost exceeds the cap', () => {
  const led = new BudgetLedger(0.05, 0);
  led.add(0.02); assert.equal(led.breached(), false);
  led.add(0.04); assert.equal(led.breached(), true);
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing `observability.ts`).

- [ ] **Step 3: Write observability.ts**

`driver/src/observability.ts`:
```typescript
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/** Tier-0 zero-dep NDJSON run log (§10). */
export class RunLog {
  constructor(private path: string) { mkdirSync(dirname(path), { recursive: true }); }
  async write(record: Record<string, unknown>): Promise<void> {
    const fh = await open(this.path, 'a');
    try { await fh.write(`${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`); }
    finally { await fh.close(); }
  }
}

/** Cost/token ledger + circuit breaker (§10). $ figures are client-side estimates. */
export class BudgetLedger {
  private usd = 0;
  private tokens = 0;
  constructor(private capUsd: number, private capTokens: number) {}
  add(usd: number, tokens = 0): void { this.usd += usd; this.tokens += tokens; }
  spentUsd(): number { return this.usd; }
  breached(): boolean {
    if (this.capUsd > 0 && this.usd >= this.capUsd) return true;
    if (this.capTokens > 0 && this.tokens >= this.capTokens) return true;
    return false;
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: observability tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver/src/observability.ts driver/test/observability.test.ts
git commit -m "feat(driver): Tier-0 NDJSON run log + budget breaker"
```

### Task 9: The single-bead tick — orchestrator (the thesis)

**Files:** Create `driver/src/orchestrator.ts`, `driver/test/orchestrator.test.ts`

This wires it together: claim via the Cage path → dispatch one Dealer → mechanical gate (injected) → **independent** Auditor (a different role instance, firewalled) → Cage serialized close, journaled for resume.

- [ ] **Step 1: Write the failing test**

`driver/test/orchestrator.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSingleBeadTick } from '../src/orchestrator.ts';
import { Beads } from '../src/beads.ts';
import { WriteQueue } from '../src/write-queue.ts';
import { Journal } from '../src/journal.ts';
import { RunLog, BudgetLedger } from '../src/observability.ts';
import { MockAdapter } from '../src/adapters/mock.ts';
import type { ExecFn } from '../src/exec.ts';

function fakeBdExec(): { fn: ExecFn; calls: string[] } {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (key.startsWith('bd ready')) return { stdout: JSON.stringify([{ id: 'b1', status: 'open', inScopeDirs: ['src'] }]), stderr: '', code: 0 };
    return { stdout: '{}', stderr: '', code: 0 };
  };
  return { fn, calls };
}

async function harness(dir: string) {
  const { fn, calls } = fakeBdExec();
  const queue = new WriteQueue();
  const beads = new Beads(fn, queue);
  const journal = new Journal(join(dir, 'journal.jsonl'));
  const log = new RunLog(join(dir, 'events.jsonl'));
  const ledger = new BudgetLedger(1, 0);
  const dealer = new MockAdapter({ b1: { beadId: 'b1', role: 'dealer', status: 'done', summary: 'impl', filesTouched: ['src/a.ts'], costUsd: 0.01 } });
  const auditor = new MockAdapter({ b1: { beadId: 'b1', role: 'auditor', status: 'done', summary: 'verified', filesTouched: [], costUsd: 0.005 } });
  const mechanicalGate = async () => ({ green: true });
  return { calls, journal, run: () => runSingleBeadTick({ beads, journal, log, ledger, dealer, auditor, mechanicalGate, worktreeRoot: dir }) };
}

test('closes the bead after Dealer + independent Auditor both pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const h = await harness(dir);
    const r = await h.run();
    assert.equal(r.closed, 'b1');
    assert.ok(h.calls.some((c) => c.startsWith('bd update b1 --claim')));
    assert.ok(h.calls.some((c) => c.startsWith('bd close b1')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('does NOT close on a red mechanical gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const { fn } = fakeBdExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(join(dir, 'journal.jsonl'));
    const log = new RunLog(join(dir, 'events.jsonl'));
    const dealer = new MockAdapter({ b1: { beadId: 'b1', role: 'dealer', status: 'done', summary: 'x', filesTouched: [], costUsd: 0 } });
    const auditor = new MockAdapter({ b1: { beadId: 'b1', role: 'auditor', status: 'done', summary: 'x', filesTouched: [], costUsd: 0 } });
    const r = await runSingleBeadTick({ beads, journal, log, ledger: new BudgetLedger(1, 0), dealer, auditor, mechanicalGate: async () => ({ green: false }), worktreeRoot: dir });
    assert.equal(r.closed, null);
    assert.equal(r.reason, 'mechanical-gate-red');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('resume is idempotent: an already-closed bead is not re-closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'f9orch-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const pre = new Journal(path);
    await pre.append({ type: 'close', beadId: 'b1' }); // simulate prior crash after close
    const { fn, calls } = fakeBdExec();
    const beads = new Beads(fn, new WriteQueue());
    const journal = new Journal(path, await Journal.replay(path));
    const dealer = new MockAdapter({ b1: { beadId: 'b1', role: 'dealer', status: 'done', summary: 'x', filesTouched: [], costUsd: 0 } });
    const auditor = new MockAdapter({ b1: { beadId: 'b1', role: 'auditor', status: 'done', summary: 'x', filesTouched: [], costUsd: 0 } });
    const r = await runSingleBeadTick({ beads, journal, log: new RunLog(join(dir, 'e.jsonl')), ledger: new BudgetLedger(1, 0), dealer, auditor, mechanicalGate: async () => ({ green: true }), worktreeRoot: dir });
    assert.equal(r.skipped, 'b1');
    assert.equal(calls.filter((c) => c.startsWith('bd close b1')).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd driver && pnpm test`
Expected: FAIL (missing `orchestrator.ts`).

- [ ] **Step 3: Write orchestrator.ts**

`driver/src/orchestrator.ts`:
```typescript
import type { Beads } from './beads.ts';
import type { Journal } from './journal.ts';
import type { RunLog, BudgetLedger } from './observability.ts';
import type { WorkerAdapter } from './adapters/adapter.ts';
import type { WorkerSpec, Bead } from './types.ts';
import { BD_WRITE_DENY, IRREVERSIBLE_DENY } from './adapters/adapter.ts';
import { validateWorkerOutcome } from './schema.ts';

export interface TickDeps {
  beads: Beads;
  journal: Journal;
  log: RunLog;
  ledger: BudgetLedger;
  dealer: WorkerAdapter;   // implements the bead
  auditor: WorkerAdapter;  // INDEPENDENT verifier — never the dealer instance (§4.1)
  mechanicalGate: (worktree: string) => Promise<{ green: boolean }>;
  worktreeRoot: string;
}

export interface TickResult {
  claimed?: string; closed?: string | null; skipped?: string; reason?: string;
}

function specFor(bead: Bead, role: 'dealer' | 'auditor', worktree: string): WorkerSpec {
  return {
    beadId: bead.id, role, model: 'sonnet', worktree,
    systemPrompt: role === 'dealer' ? 'You are a Dealer: implement one bead test-first.' : 'You are the Floor Auditor: verify against acceptance; you did NOT implement this.',
    task: `Bead ${bead.id}. Emit a WorkerOutcome JSON.`,
    allowedTools: role === 'auditor' ? ['Read', 'Bash'] : ['Read', 'Edit', 'Write', 'Bash'],
    disallowedTools: [...BD_WRITE_DENY, ...IRREVERSIBLE_DENY], // fire under bypass (§4.1)
  };
}

/** One deterministic single-bead tick. The driver — not an LLM — sequences this. */
export async function runSingleBeadTick(d: TickDeps): Promise<TickResult> {
  const ready = await d.beads.ready();
  if (ready.length === 0) return { reason: 'queue-empty' };
  const bead = ready[0];

  if (d.journal.hasDone('close', bead.id)) { await d.log.write({ kind: 'skip', beadId: bead.id }); return { skipped: bead.id }; }

  await d.journal.append({ type: 'claim', beadId: bead.id });
  await d.beads.claim(bead.id);
  await d.log.write({ kind: 'claim', beadId: bead.id });

  const worktree = `${d.worktreeRoot}/wt-${bead.id}`;

  // Dealer implements.
  const dealerOut = await d.dealer.run(specFor(bead, 'dealer', worktree));
  const dv = validateWorkerOutcome(dealerOut);
  if (!dv.ok) return { claimed: bead.id, closed: null, reason: `dealer-outcome-invalid:${dv.error}` };
  d.ledger.add(dealerOut.costUsd);
  await d.journal.append({ type: 'dispatch', beadId: bead.id, role: 'dealer' });
  await d.log.write({ kind: 'dispatch', beadId: bead.id, role: 'dealer', costUsd: dealerOut.costUsd });

  // Mechanical gate.
  const gate = await d.mechanicalGate(worktree);
  if (!gate.green) { await d.log.write({ kind: 'gate-red', beadId: bead.id }); return { claimed: bead.id, closed: null, reason: 'mechanical-gate-red' }; }

  // Independent Auditor (different adapter instance/role — author≠grader).
  const auditOut = await d.auditor.run(specFor(bead, 'auditor', worktree));
  d.ledger.add(auditOut.costUsd);
  await d.log.write({ kind: 'audit', beadId: bead.id, status: auditOut.status });
  if (auditOut.status !== 'done') return { claimed: bead.id, closed: null, reason: 'audit-failed' };

  // Cage serialized close (exactly-once via the journal guard).
  await d.journal.append({ type: 'close', beadId: bead.id });
  await d.beads.close(bead.id, 'verified by independent auditor');
  await d.log.write({ kind: 'close', beadId: bead.id });
  return { claimed: bead.id, closed: bead.id };
}
```

- [ ] **Step 4: Run tests; expect pass**

Run: `cd driver && pnpm test`
Expected: all orchestrator tests PASS (close-on-pass, no-close-on-red, idempotent-resume).

- [ ] **Step 5: Commit**

```bash
git add driver/src/orchestrator.ts driver/test/orchestrator.test.ts
git commit -m "feat(driver): deterministic single-bead tick (claim->dealer->gate->independent audit->close), resumable"
```

### Task 10: CLI entry + launcher + wire into the validate gate

**Files:** Create `driver/src/main.ts`, `scripts/launch-driver.sh`; Modify `tests/validate-plugin.sh`

- [ ] **Step 1: Write main.ts (thin argv → config → banner)**

`driver/src/main.ts`:
```typescript
import { resolveConfig, type Backend } from './config.ts';

function parseArgv(argv: string[]): { backend?: Backend; goal: string; budgetUsd?: number } {
  let backend: Backend | undefined;
  let goal = '';
  let budgetUsd: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backend') backend = argv[++i] as Backend;
    else if (argv[i] === '--goal') goal = argv[++i] ?? '';
    else if (argv[i] === '--budget-usd') budgetUsd = Number(argv[++i]);
  }
  return { backend, goal, budgetUsd };
}

const cfg = resolveConfig(parseArgv(process.argv.slice(2)));
console.log(cfg.banner);
// Slice 2+ wires the full capped loop over runSingleBeadTick; Slice 1 proves the banner + config gate.
```

- [ ] **Step 2: Write the launcher**

`scripts/launch-driver.sh`:
```bash
#!/usr/bin/env bash
# Launch the deterministic driver. Invoked by /clock-in (hands-off mode). Git-Bash-compatible.
set -uo pipefail
F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$F9_ROOT/driver" || { echo "driver/ not found" >&2; exit 1; }
exec npx --no-install tsx src/main.ts "$@"
```

- [ ] **Step 3: Verify launcher syntax + run the banner**

Run: `bash -n scripts/launch-driver.sh && cd driver && npx tsx src/main.ts --backend codex --goal "demo" --budget-usd 5`
Expected: prints `This shift bills codex as subscription; K=1, cap=30, budget<=$5/∞ tokens.`

- [ ] **Step 4: Add a driver step to the validate gate**

In `tests/validate-plugin.sh`, add a check group (near the other groups) that runs the driver toolchain when `driver/` exists and `node`/`pnpm` are available:

```bash
# --- driver/ TypeScript checks (skip gracefully if toolchain absent) ---
if [ -d "$ROOT/driver" ] && command -v node >/dev/null 2>&1; then
  ( cd "$ROOT/driver" \
    && pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1; \
    pnpm run typecheck && pnpm run lint && pnpm test ) \
    && echo "  ✓ driver: typecheck + lint + tests" \
    || { echo "  ✗ driver checks failed"; FAIL=1; }
else
  echo "  • driver checks skipped (node/pnpm absent)"
fi
```

(Adapt `ROOT`/`FAIL` to the script's existing variable names.)

- [ ] **Step 5: Run the full gate**

Run: `bash tests/validate-plugin.sh`
Expected: GREEN — existing checks pass AND the driver group passes.

- [ ] **Step 6: Commit**

```bash
git add driver/src/main.ts scripts/launch-driver.sh tests/validate-plugin.sh
git commit -m "feat(driver): CLI entry + launcher; wire driver typecheck/lint/tests into the gate"
```

---

## Self-Review

**Spec coverage (Slice 0 + Slice 1):**
- §2.1 subscription-first serialized, credential safety, banner → Task 7 ✓; live proof → Slice 0 ✓
- §3.1 code-driven dispatch → Task 9 ✓ · §3.2 single-writer queue → Task 3 + Task 4 ✓
- §4.1 deny-rules fire under bypass; no worker write-path → Task 6 (deny-rules) + Task 4 (writes only via the driver's queue) + Task 9 (auditor independent) ✓
- §5.6 durable journal + idempotent resume → Task 5 + Task 9 (idempotent-resume test) ✓
- §7 gate under bypass → Slice 0 smoke (Task S0.2) + deny-rules (Task 6) ✓
- §8 bd CLI `--json`, writes via queue, `git worktree` (no `bd worktree`) → Task 4 ✓ (worktree-create path lands in Slice 2; Task 9 uses a worktree path string only)
- §10 Tier-0 NDJSON + budget breaker → Task 8 ✓
- §12 dispatch determinism, author≠grader, gate-red, resume, budget → Tasks 7–9 tests ✓
- Toolchain (Node20/tsx/pnpm/node:test/biome, zero runtime deps), gate wiring → Task 1 + Task 10 ✓

**Deferred to Slice 2+ (out of scope here, noted so it's not mistaken for a gap):** K≥2 parallelism + the layered `git merge-tree` independence backstop; real `git worktree add` creation/lease/dead-PID prune (Task 9 uses a path only); the live Claude/Codex adapter exec (built + flag-tested in Task 6; exercised live in Slice 0); the strategy tick; the memory layer; Tier-1 OTel; the full capped loop in `main.ts`.

**Placeholder scan:** none — every code step has complete code; every run step has a command + expected output.

**Type consistency:** `WorkerOutcome`/`WorkerSpec`/`Role` defined in Task 2 and used unchanged in Tasks 6, 9; `WriteQueue.run` (Task 3) used by `Beads` (Task 4); `Journal.hasDone/append/replay` (Task 5) used by the orchestrator (Task 9); `BudgetLedger`/`RunLog` (Task 8) used in Task 9. Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-slice0-slice1-driver.md`.
