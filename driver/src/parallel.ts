import type { WorkerAdapter } from './adapters/adapter.ts';
import type { Beads } from './beads.ts';
import { independentFrontier } from './frontier.ts';
import type { Journal } from './journal.ts';
import type { TickOutcome } from './loop.ts';
import type { BudgetLedger, RunLog } from './observability.ts';
import { validateWorkerOutcome } from './schema.ts';
import type { Bead } from './types.ts';
import { specFor } from './worker-spec.ts';
import type { Worktrees } from './worktree.ts';

export interface ParallelTickDeps {
  beads: Beads;
  worktrees: Worktrees;
  journal: Journal;
  log: RunLog;
  ledger: BudgetLedger;
  dealer: WorkerAdapter;
  auditor: WorkerAdapter;
  mechanicalGate: (worktree: string) => Promise<{ green: boolean }>;
  k: number;
  baseBranch: string;
}

interface Candidate {
  bead: Bead;
  branch: string;
  worktree: string;
  ok: boolean;
  reason: string;
}

/**
 * One parallel tick (spec §3.1/§5.2): up to K Dealers run IN PARALLEL over the write-independent
 * frontier (each in its own worktree), each gated + independently audited; then integration is
 * SERIALIZED through the Cage — one merge/close at a time, with the merge-tree backstop re-queuing
 * any collision the static independence check missed.
 */
export async function runParallelTick(d: ParallelTickDeps): Promise<TickOutcome> {
  const ready = (await d.beads.ready()).filter((b) => !d.journal.hasDone('close', b.id));
  if (ready.length === 0) return { closedIds: [], empty: true };

  const frontier = independentFrontier(ready, { k: d.k });

  // Phase 1 — PARALLEL: implement + gate + independently verify each frontier bead in isolation.
  const candidates = await Promise.all(
    frontier.map(async (bead): Promise<Candidate> => {
      const branch = `shift/${bead.id}`;
      await d.journal.append({ type: 'claim', beadId: bead.id });
      await d.beads.claim(bead.id);
      const worktree = await d.worktrees.add(bead.id, branch);

      const dealerOut = await d.dealer.run(specFor(bead, 'dealer', worktree));
      d.ledger.add(dealerOut.costUsd);

      const gate = await d.mechanicalGate(worktree);
      if (!gate.green) return { bead, branch, worktree, ok: false, reason: 'gate-red' };

      const auditOut = await d.auditor.run(specFor(bead, 'auditor', worktree));
      d.ledger.add(auditOut.costUsd);
      const ok = validateWorkerOutcome(auditOut).ok && auditOut.status === 'done';
      return { bead, branch, worktree, ok, reason: ok ? 'pass' : 'audit-failed' };
    }),
  );

  // Phase 2 — SERIALIZED: integrate through the single-writer Cage, one at a time (spec §3.2).
  const closedIds: string[] = [];
  for (const c of candidates) {
    if (!c.ok) {
      await d.worktrees.remove(c.worktree);
      await d.log.write({ kind: 'reject', beadId: c.bead.id, reason: c.reason });
      continue;
    }
    if (!(await d.worktrees.mergesClean(d.baseBranch, c.branch))) {
      // The merge-tree backstop caught a collision the static check missed → re-queue (leave open).
      await d.worktrees.remove(c.worktree);
      await d.log.write({ kind: 'merge-conflict-requeue', beadId: c.bead.id });
      continue;
    }
    // Integrate: merge the bead's branch onto the base (exactly-once via journal).
    if (!d.journal.hasDone('merge', c.bead.id)) {
      await d.worktrees.merge(d.baseBranch, c.branch);
      await d.journal.append({ type: 'merge', beadId: c.bead.id });
      await d.log.write({ kind: 'merge', beadId: c.bead.id });
    }
    await d.journal.append({ type: 'close', beadId: c.bead.id });
    await d.beads.close(c.bead.id, 'verified by independent auditor');
    await d.worktrees.remove(c.worktree);
    await d.log.write({ kind: 'close', beadId: c.bead.id });
    closedIds.push(c.bead.id);
  }

  return { closedIds, empty: false };
}
