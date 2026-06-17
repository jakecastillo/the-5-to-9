# Phase 1c — Wire the gate into the live driver loop (perform-on-approve)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the interactive gate **fire during a real run**. When a sandboxed worker surfaces an irreversible/outward action it cannot run, the driver requests consent; on a human **type-to-confirm APPROVE**, the driver performs the **EXACT** approved command itself, fully audited; on DENY/timeout/error the bead stays **blocked** and nothing runs.

**Decision (locked):** perform-on-approve. Safety = exact-command-only, default-deny, single hardened consent implementation, full journal audit.

**Architecture move (required):** the consent contract relocates from `cli/src/consent.ts` into the **`driver` package** (`driver/src/consent.ts`) so the orchestrator (driver) AND the CLI/TUI share ONE hardened implementation. `cli` depends on `driver`, so importing the other way would be circular and re-implementing it would duplicate the F1–F4 security logic. The CLI re-imports the same symbols from `@the-5-to-9/driver`.

## Global Constraints (security — non-negotiable, Eye in the Sky will attack these)
- **Exact-command integrity:** the command that is classified → shown to the human (token) → approved → executed MUST be the byte-identical string. No re-derivation, normalization, or mutation between approval and execution. The driver executes the pending record's stored command verbatim.
- **Default DENY:** perform ONLY on `resolution.approved === true`. DENY, timeout, parse/IO error, or ANY thrown error → do NOT perform; leave the bead blocked. Never silent-allow.
- **Consent is mandatory before perform:** there must be NO code path that runs `requestedAction` without a passed consent checkpoint. (Eye verifies by grep + attack.)
- **Idempotent/resumable:** a `'gate'` journal entry marks the decision; on resume an already-performed approved action is not re-performed (mirror the close/merge `hasDone` guard).
- Preserve the existing F1–F4 hardening verbatim during the move (path-safe ids, exclusive write-once, degenerate-token refusal, boolean-shape validation). The `consent.security.test.ts` suite MUST move with it and pass.
- Do NOT touch `hooks/`, `scripts/`, `skills/`, `commands/`, `tests/validate-plugin.sh`, version-consistency files. Work is in `driver/` + `cli/`.
- The sandboxed-worker `IRREVERSIBLE_DENY` rules stay — workers still can't run irreversible commands; they SURFACE them.

## File Structure
```
driver/src/consent.ts            (MOVED from cli/src/consent.ts; F1–F4 intact)
driver/src/consent.test.ts       (MOVED) + driver/src/consent.security.test.ts (MOVED)
driver/src/types.ts              (MODIFY) WorkerOutcome gains `requestedAction?: string`
driver/src/schema.ts             (MODIFY) validate optional requestedAction (string)
driver/src/schemas/worker-outcome.json (MODIFY) optional requestedAction
driver/src/adapters/claude.ts    (MODIFY) parse requestedAction from the worker outcome
driver/src/adapters/codex.ts     (MODIFY) parse requestedAction from the worker outcome
driver/src/orchestrator.ts       (MODIFY) the consent checkpoint + perform-on-approve
driver/src/main.ts               (MODIFY) inject consent deps + exec into TickDeps
cli/src/consent.ts               (DELETE → re-export shim from '@the-5-to-9/driver' OR update all importers)
cli/src/gate.ts, operations/gate.ts, operations/dashboard-model.ts, operations/run.ts,
  ui/GateModal.tsx + their tests  (MODIFY imports → '@the-5-to-9/driver')
```

## Tasks (TDD; commit per task; keep commit messages free of literal gated phrases)

### Task 1: Relocate the consent contract into the driver package
- [ ] Move `cli/src/consent.ts` → `driver/src/consent.ts` and its tests (`consent.test.ts`, `consent.security.test.ts`) into `driver/src/`. Keep ALL F1–F4 logic byte-for-byte. Export the same symbols.
- [ ] Update every CLI importer to import from `@the-5-to-9/driver` (or `@the-5-to-9/driver/src/consent.ts` to match the existing driver-import convention): `cli/src/operations/{gate,dashboard-model,run}.ts`, `cli/src/ui/GateModal.tsx`, and their tests. (Optionally leave a 1-line re-export shim at `cli/src/consent.ts` to minimize churn — your call.)
- [ ] **Verify:** `pnpm -C driver test` (consent + security suites pass in the driver) AND `pnpm -C cli test` (all CLI tests still pass against the relocated import). **Commit** `refactor(gate): relocate the hardened consent contract into the driver package`.

### Task 2: WorkerOutcome.requestedAction (surface an outward action)
- [ ] Add optional `requestedAction?: string` to `WorkerOutcome` (`types.ts`); validate it in `schema.ts` (must be a string if present, else reject); add it as optional to `schemas/worker-outcome.json`. Parse it in `adapters/claude.ts` + `adapters/codex.ts` from the worker's structured outcome.
- [ ] **Failing test first:** `validateWorkerOutcome` accepts an outcome with a string `requestedAction` and rejects a non-string; the adapters surface it. **Commit** `feat(driver): WorkerOutcome can surface a requestedAction (outward action needing consent)`.

### Task 3: Orchestrator consent checkpoint + perform-on-approve
- [ ] Extend `TickDeps` with: `requestConsent`, `awaitResolution` (defaults from `./consent.ts`), `stateDir`, and `exec: ExecFn` (to perform the approved command). Add a `now?` for test clocks.
- [ ] In `runSingleBeadTick`, after a worker outcome with a non-empty `requestedAction`: classify it; if not irreversible → run it normally (or skip — keep scope: only gate flagged actions). If flagged → `requestConsent({command: requestedAction, beadId, role})`, `awaitResolution(id)`, journal a `'gate'` event with `approved`. On `approved === true` → perform the **exact** `requestedAction` via `exec` (e.g. `exec('bash', ['-c', requestedAction], {cwd})`) and continue; on false/timeout/throw → return `{claimed, closed:null, reason:'gate-denied'}` (bead stays blocked, NOT closed). Guard re-perform on resume with `journal.hasDone('gate', bead.id)`.
- [ ] **Failing tests first** (mocked exec + injected clock): approve → the EXACT command is passed to exec, `'gate'` journaled approved, bead proceeds; deny → exec NEVER called, bead not closed, `'gate'` journaled denied; timeout → exec NEVER called (default-deny); a thrown consent error → exec NEVER called; resume with `hasDone('gate')` → not re-performed. **Commit** `feat(driver): tick gates a surfaced outward action and performs only the exact approved command`.

### Task 4: Wire consent deps in the composition root
- [ ] In `main.ts`, build the consent deps from the real `consent.ts` (bound to `stateDir`) + pass `exec` into `TickDeps` (and `ParallelTickDeps` if you wire the parallel path — otherwise leave parallel unchanged and note it). Keep the K=1 path the primary wiring.
- [ ] **Verify:** `pnpm -C driver test` green; `node driver/src/main.ts --help` still works. **Commit** `feat(driver): inject consent + exec into the tick (gate fires on a real run)`.

### Task 5: Gate green end-to-end
- [ ] Run `bash tests/validate-plugin.sh` → GREEN (driver group + cli group). Confirm `pnpm -C cli run build` still works and the CLI gate subcommand + TUI still resolve the (relocated) consent. **Commit** `test(gate): Phase-1c driver wiring — gate green`.

## Self-Review (author) + mandatory Eye in the Sky pass
- **Exact-command integrity, default-deny, mandatory-consent, idempotent-resume** are the four invariants; each maps to a Task-3 test. After the agent, an **independent Eye in the Sky review** must attack: (a) can any path exec `requestedAction` without a passed checkpoint? (b) is the executed string byte-identical to the approved one (no shell-expansion surprise the human didn't approve)? (c) deny/timeout/throw never execs? (d) resume can't double-perform? Do NOT integrate until that review passes.
- **Out of scope:** the parallel (K≥2) tick consent path (note it if unwired); re-dispatch-to-worker semantics (we chose orchestrator-perform).
