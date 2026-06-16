import type { Bead } from './types.ts';

export interface ValuedBead extends Bead {
  /** 0..1: does closing this directly satisfy an acceptance criterion? */
  acceptanceProximity?: number;
  /** How many currently-blocked beads this unblocks. */
  unblocks?: number;
  /** Repeated failures / effort — a staleness/cost proxy. */
  failedAttempts?: number;
  createdByHuman?: boolean;
  hasProgress?: boolean;
}

/** v1 value rubric (spec §5.3): acceptance-proximity + unblock-count − staleness/cost. */
export function scoreBeadValue(b: ValuedBead): number {
  const proximity = b.acceptanceProximity ?? 0;
  const unblock = b.unblocks ?? 0;
  const cost = b.failedAttempts ?? 0;
  return proximity + 0.5 * unblock - 0.25 * cost;
}

export type StrategyAction =
  | { kind: 'reprioritize'; beadId: string; priority: number }
  | { kind: 'add'; bead: Bead }
  | { kind: 'prune'; beadId: string };

export interface StrategyResult {
  applied: StrategyAction[];
  rejected: { action: StrategyAction; reason: string }[];
}

/**
 * Enforce the bounded-autonomy invariants (spec §5.3). The strategy tick may only
 * re-prioritize existing beads, ADD new ones, or PRUNE a machine-created, no-progress bead.
 * It may NEVER prune a human-created or in-progress bead. Illegal proposals are rejected,
 * never applied — this is the safety floor for autonomous backlog churn.
 */
export function enforceStrategy(actions: StrategyAction[], backlog: ValuedBead[]): StrategyResult {
  const byId = new Map(backlog.map((b) => [b.id, b]));
  const applied: StrategyAction[] = [];
  const rejected: StrategyResult['rejected'] = [];

  for (const a of actions) {
    if (a.kind === 'reprioritize' || a.kind === 'add') {
      applied.push(a);
      continue;
    }
    // prune: only legal for an existing, machine-created, no-progress bead.
    const b = byId.get(a.beadId);
    if (!b) {
      rejected.push({ action: a, reason: 'unknown bead' });
      continue;
    }
    if (b.createdByHuman) {
      rejected.push({ action: a, reason: 'cannot prune a human-created bead' });
      continue;
    }
    if (b.hasProgress) {
      rejected.push({ action: a, reason: 'cannot prune a bead with progress' });
      continue;
    }
    applied.push(a);
  }

  return { applied, rejected };
}
