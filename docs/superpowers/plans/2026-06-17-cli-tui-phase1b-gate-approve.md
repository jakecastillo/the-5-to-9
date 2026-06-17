# Phase 1b — Interactive gate APPROVE loop (CLI/TUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Close the interactive gate loop — when a run hits an irreversible/outward action, a human **approves or denies** it (type-to-confirm in the TUI, or a scriptable subcommand), durably and resumably, and the run honors the decision. Fail-closed: default DENY, never silent-allow.

**Architecture:** A small, file-based **consent contract** under the shift state dir (already excluded from the target's git via `.git/info/exclude`). Both the TUI modal and a `the-5-to-9 gate` subcommand read/write the same records. The facade surfaces a pending request as `pendingGate` (the TUI's `App.tsx` already opens a modal on it). The driver requests consent + awaits resolution at a single, well-defined checkpoint — it does NOT rearchitect the sandboxed-worker model (that's Phase 2).

**Tech stack:** matches the existing `cli/` package — TypeScript ESM, ink@5 / react@18, vitest + ink-testing-library, commander, tsup. No new deps expected.

## Global Constraints
- **Fail-closed, default DENY.** `Esc` / Enter-on-default / timeout / any parse error → DENY. A wrong token can NEVER approve. Never silent-allow.
- **Non-TTY never shows a modal** — it refuses and prints the scriptable `the-5-to-9 gate approve <id> --token <tok>` instruction; consent stays automatable.
- **Durable + resumable.** A crash after writing the pending record re-reads it on resume; a crash after a resolution honors that resolution (write-once).
- **State location:** `<stateDir>/consent/` where `stateDir = $(repoRoot)/.claude/five-to-nine` (already git-excluded — no leak). Reuse `cli/src/paths.ts`.
- **No new orchestration logic in the TUI.** The modal calls `consent.resolve(...)`; nothing else.
- **Do not touch** `hooks/`, `scripts/`, `skills/`, `commands/`, `tests/validate-plugin.sh`, version-consistency files. Work is inside `cli/` (+ a narrow, additive `driver/src` checkpoint only if needed and test-safe).

---

## File Structure
```
cli/src/consent.ts              (NEW) the consent contract: request / list / resolve / await
cli/src/consent.test.ts         (NEW)
cli/src/ui/GateModal.tsx        (NEW; replaces/upgrades the surface-only GateNotice) type-to-confirm
cli/src/ui/GateModal.test.tsx   (NEW)
cli/src/operations/dashboard-model.ts  (MODIFY) populate pendingGate from consent.listPending()
cli/src/operations/gate.ts      (NEW) gateApprove/gateDeny/gatePending operations over consent.ts
cli/src/cli.ts                  (MODIFY) add `gate` subcommand (pending|approve|deny)
cli/src/operations/run.ts       (MODIFY) requestConsent + awaitResolution at the gate checkpoint
```

## Consent record formats (the contract)
- **Pending** `<stateDir>/consent/<id>.pending.json`:
  `{ "id": string, "command": string, "category": string, "beadId": string|null, "role": string|null, "token": string, "createdAt": string }`
  `token` = the canonical confirm string the human must type (e.g. the action verb or target remote) — shown verbatim in the modal.
- **Resolution** `<stateDir>/consent/<id>.resolved.json`:
  `{ "id": string, "approved": boolean, "token": string|null, "resolvedAt": string }` (write-once; a second resolve is a no-op error).

---

## Tasks

### Task 1: `consent.ts` module
**Files:** Create `cli/src/consent.ts`, `cli/src/consent.test.ts`.
**Produces:** `interface PendingConsent {id;command;category;beadId;role;token;createdAt}` · `interface Resolution {id;approved;token;resolvedAt}` · `requestConsent(input: {command;category;beadId?;role?;token?}): PendingConsent` (writes the pending file; default `token` = derived canonical string) · `listPending(): PendingConsent[]` · `resolve(id: string, approved: boolean, token?: string): {ok: boolean; error?: string}` (on approve, REQUIRE `token === pending.token` else `{ok:false,error}`; write-once) · `readResolution(id): Resolution | null` · `awaitResolution(id, opts?: {timeoutMs?; pollMs?; now?: () => number}): Promise<Resolution>` (polls; on timeout returns a DENY resolution).
- [ ] **Step 1: failing tests** — request writes a pending file; `listPending` returns it; `resolve(id,true,'wrong')` → `{ok:false}` and NO resolution written; `resolve(id,true,correctToken)` → approved resolution; second `resolve` → no-op error (write-once); `awaitResolution` with an injected clock returns a DENY on timeout; a pre-existing resolution is read immediately (resumable).
- [ ] **Step 2: run, verify FAIL** — `pnpm -C cli test consent`.
- [ ] **Step 3: implement** — file I/O under `paths.stateDir()/consent`; atomic write (tmp + rename); token validation; timeout→deny.
- [ ] **Step 4: verify PASS.** **Step 5: commit** `feat(gate): consent contract module (request/list/resolve/await, default-deny, write-once)`.

### Task 2: facade populates `pendingGate`
**Files:** Modify `cli/src/operations/dashboard-model.ts`; extend `dashboard-model.test.ts`.
**Interfaces:** `DashboardModel.pendingGate?: { id; command; category; beadId; role; token }` (the field App.tsx already reads) is set from `consent.listPending()[0]`, else `undefined`.
- [ ] **Step 1: failing test** — with a pending consent file present, `getDashboardModel().pendingGate` is the record; with none, it's `undefined`.
- [ ] Steps 2–4 (FAIL → implement → PASS). **Step 5: commit** `feat(gate): surface pending consent as pendingGate in the dashboard model`.

### Task 3: `GateModal` (type-to-confirm) — upgrade GateNotice
**Files:** Create `cli/src/ui/GateModal.tsx`, `cli/src/ui/GateModal.test.tsx`; wire it where `App.tsx` opens the gate modal (replacing the surface-only GateNotice for the pending-consent case).
**Behavior:** focus-trap; render command + category + bead/role + the required token; **default focus DENY**; `Esc` or Enter-on-default → `consent.resolve(id,false)` + close; a `<TextInput>` for the token — Enter with the CORRECT token → `consent.resolve(id,true,token)` + close; wrong token → stays open with an error, does NOT approve.
- [ ] **Step 1: failing tests (ink-testing-library)** — modal renders the command + token; a bare Enter (default) denies (assert `resolve` called with `false`); typing the WRONG token + Enter does NOT approve (no `resolve(true)`, modal stays); typing the correct token + Enter approves; `Esc` denies. Inject a `resolve` spy.
- [ ] Steps 2–4. **Step 5: commit** `feat(tui): GateModal type-to-confirm (default deny, wrong token rejected, Esc denies)`.

### Task 4: `gate` subcommand (non-TTY/scriptable)
**Files:** Create `cli/src/operations/gate.ts`; modify `cli/src/cli.ts`; tests.
**Behavior:** `the-5-to-9 gate pending` (list pending: id, command, category, token), `gate approve <id> --token <tok>` (→ `consent.resolve(id,true,tok)`; nonzero exit + message on wrong/missing token), `gate deny <id>` (→ `resolve(id,false)`). The TUI's non-TTY path prints "irreversible action pending — approve with: the-5-to-9 gate approve <id> --token <tok>" instead of a modal.
- [ ] **Step 1: failing tests** — `runCli(['gate','pending'])` lists a pending record; `gate approve <id> --token wrong` → nonzero, no approval; `--token <correct>` → approved; `gate deny <id>` → denied.
- [ ] Steps 2–4. **Step 5: commit** `feat(cli): gate pending/approve/deny subcommand for scriptable consent`.

### Task 5: driver/run consent checkpoint (narrow, additive)
**Files:** Modify `cli/src/operations/run.ts` (and a minimal additive `driver/src` hook ONLY if required and test-safe); tests with a mocked driver + injected clock.
**Behavior:** at the point the run would otherwise hard-stop on an irreversible/outward action (classified via `gate.classifyCommand`), call `requestConsent(...)` then `awaitResolution(id)`; **approved → proceed; denied/timeout → skip the action, record it, journal a `'gate'` event and continue.** Do NOT change the sandboxed-worker deny-rules; this governs the orchestrator-level decision to proceed past a flagged action. Keep the worker `IRREVERSIBLE_DENY` rules intact.
- [ ] **Step 1: failing test** — with an injected resolver that approves, the checkpoint proceeds; with deny/timeout, it skips + records a `'gate'` journal event; no silent-allow. Mock the clock so the test is fast/deterministic.
- [ ] Steps 2–4. **Step 5: commit** `feat(gate): run checkpoint requests consent + honors approve/deny (durable, resumable)`.

### Task 6: gate green + build
- [ ] Run `bash tests/validate-plugin.sh` → GREEN (the `cli` group runs vitest over the new tests). Confirm `pnpm -C cli run build` + `node cli/dist/bin.js gate pending` works. Commit any wiring. `test(gate): Phase-1b interactive consent loop — gate green`.

## Self-Review (author)
- **Spec coverage:** pending-consent event + journaled resolution (T1,T5); type-to-confirm modal (T3); facade pendingGate (T2); scriptable non-TTY path (T4); default-deny/fail-closed (T1,T3,T4 constraints). ✅
- **Security invariants** (verify adversarially before merge): wrong token never approves; Esc/timeout/parse-error → deny; non-TTY never silent-allows; resolution is write-once + resumable. These are tested in T1/T3/T4 and must be re-verified by an independent pass.
- **Out of scope:** sandboxed workers *performing* approved irreversible actions (Phase 2); the plugin PreToolUse hook stays a synchronous deny (it cannot block on a TUI).
