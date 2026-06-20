#!/usr/bin/env node
// The 5 to 9 — Stop hook: the beads-aware shift loop (the ralph heartbeat), ported
// from hooks/shift-loop.sh to zero-dep Node (the fragile bit was the JSON-string
// build + the cap/drain/stall text logic). Blocks the stop and re-injects "advance
// the shift" while there is ready work and budget; ALLOWS the stop (clock out) when
// the backlog is drained, the cap is hit, or progress stalls. No active shift → no-op.
// Always exits 0 (a crashing loop hook must never break the host). Node 18+.
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── pure decision core (unit-tested in shift-loop.test.mjs) ──────────────────

// Read the YAML frontmatter (between the first two `---` fences) into a flat object,
// stripping one layer of surrounding double quotes from each value.
export function parseFrontmatter(text) {
  const out = {};
  let seen = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '---') {
      seen += 1;
      if (seen >= 2) break;
      continue;
    }
    if (seen !== 1) continue;
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

// uncapped / none / 0 / empty → null (no ceiling). A positive integer → that cap.
// Non-numeric junk → the env fallback if numeric, else 30 (mirrors the bash case).
export function resolveMaxIter(raw, envFallback) {
  const v = String(raw ?? '').trim();
  if (v === '' || v === 'uncapped' || v === 'none' || v === '0') return null;
  if (/^[0-9]+$/.test(v)) return Number(v);
  const fb = String(envFallback ?? '').trim();
  return /^[0-9]+$/.test(fb) ? Number(fb) : 30;
}

// Decide allow (clock out) vs block (advance), in the same order as the bash hook:
// hard cap → backlog drained → no-progress stall → otherwise block. `closed` may be
// null when bd is unavailable, in which case the stall check is skipped (no snapshot).
export function decide({ iter, maxIter, ready, closed, prevClosed, prevStall, stallMax, goal }) {
  if (maxIter != null && iter > maxIter) return { action: 'allow', reasonCode: 'cap', snapshot: null };
  if (ready === 0) return { action: 'allow', reasonCode: 'drained', snapshot: null };

  let snapshot = null;
  if (closed != null) {
    const stall = closed === prevClosed ? prevStall + 1 : 0;
    snapshot = { closed, stall };
    if (stall >= stallMax) return { action: 'allow', reasonCode: 'no-progress', snapshot };
  }
  return { action: 'block', reason: buildBlockReason({ iter, maxIter, ready, goal }), snapshot };
}

export function buildBlockReason({ iter, maxIter, ready, goal }) {
  const cap = maxIter == null ? '∞' : String(maxIter);
  return (
    `Advance The 5 to 9 shift (iteration ${iter}/${cap}). Per the running-the-shift skill ` +
    `(first ground in THIS repo's AGENTS.md/README + guardrails and obey them — repo wins ` +
    `over defaults): claim the next ready bead (bd ready --claim), implement it TDD as the ` +
    `Dealer, run the repo's real mechanical gate (no green, no close), have the Floor Auditor ` +
    `verify independently against acceptance, commit on the shift branch, then bd close and ` +
    `note why in beads. ${ready} bead(s) ready. Goal: ${goal}. Stop only when bd ready is ` +
    `empty or you hit the cap; hard-stop and surface (never perform) any irreversible outward action.`
  );
}

export function blockEnvelope(reason) {
  return JSON.stringify({ decision: 'block', reason: String(reason) });
}

// ── IO glue (not unit-tested; exercised end-to-end by tests/smoke-shift.sh) ──

function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

function bd(args) {
  try {
    return execFileSync('bd', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function readyCount() {
  const out = bd(['ready', '--json']);
  if (out == null) return 0; // bd/db unavailable → treat as drained (matches f9_ready_count)
  try {
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* fall through to the id-count fallback below */
  }
  return (out.match(/"id"/g) || []).length;
}

function closedCount() {
  const out = bd(['count', '--status', 'closed']);
  if (out == null) return null; // unavailable → skip the no-progress check
  const m = out.match(/[0-9]+/);
  return m ? Number(m[0]) : null;
}

function readSnapshot(path) {
  try {
    const [closed, stall] = readFileSync(path, 'utf8').trim().split(/\s+/);
    const pc = /^-?[0-9]+$/.test(closed) ? Number(closed) : -1;
    const ps = /^[0-9]+$/.test(stall) ? Number(stall) : 0;
    return { prevClosed: pc, prevStall: ps };
  } catch {
    return { prevClosed: -1, prevStall: 0 };
  }
}

function main() {
  const root = repoRoot();
  const stateDir = join(root, '.claude', 'five-to-nine');
  const stateFile = join(stateDir, 'shift.local.md');

  // No-clobber: no active shift → do nothing, let the session stop normally.
  if (!existsSync(stateFile)) return;
  const fm = parseFrontmatter(readFileSync(stateFile, 'utf8'));
  if (fm.status !== 'active') return;

  // Ensure a detached worktree / odd cwd still finds the primary beads DB.
  if (!process.env.BEADS_DIR) {
    const beads = join(root, '.beads');
    try {
      if (statSync(beads).isDirectory()) process.env.BEADS_DIR = beads;
    } catch {
      /* no .beads — bd auto-discovery handles it */
    }
  }

  const maxIter = resolveMaxIter(fm.max_iterations, process.env.FIVE_TO_NINE_MAX_ITER);

  // Iteration counter — must persist across fresh Stop-hook processes or the cap
  // can't advance; if we can't persist it, fail safe by ALLOWING the stop.
  const counterPath = join(stateDir, 'iteration.count');
  let iter = 0;
  try {
    const raw = readFileSync(counterPath, 'utf8').trim();
    if (/^[0-9]+$/.test(raw)) iter = Number(raw);
  } catch {
    /* first iteration */
  }
  iter += 1;
  try {
    writeFileSync(counterPath, `${iter}\n`);
  } catch {
    process.stderr.write(`⚠️  [5to9] cannot persist iteration counter (${counterPath}) — clocking out to stay capped\n`);
    return;
  }

  const stallMax = (() => {
    const v = String(process.env.FIVE_TO_NINE_NOPROGRESS ?? '').trim();
    return /^[0-9]+$/.test(v) ? Number(v) : 3;
  })();

  const snapPath = join(stateDir, 'closed.snapshot');
  const { prevClosed, prevStall } = readSnapshot(snapPath);

  const d = decide({
    iter,
    maxIter,
    ready: readyCount(),
    closed: closedCount(),
    prevClosed,
    prevStall,
    stallMax,
    goal: fm.goal ?? '',
  });

  if (d.snapshot) {
    try {
      writeFileSync(snapPath, `${d.snapshot.closed} ${d.snapshot.stall}\n`);
    } catch {
      /* best-effort; a missed snapshot only delays the stall guard by one tick */
    }
  }

  if (d.action === 'block') process.stdout.write(`${blockEnvelope(d.reason)}\n`);
  // allow → emit nothing; the model is allowed to stop.
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    // Never let an unexpected error break the host's Stop handling — fail OPEN.
  }
  process.exitCode = 0;
}
