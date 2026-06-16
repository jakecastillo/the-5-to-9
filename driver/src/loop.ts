import type { Journal } from './journal.ts';
import type { BudgetLedger, RunLog } from './observability.ts';

/** What one tick reports back to the loop. */
export interface TickOutcome {
  closedIds: string[];
  empty: boolean;
}

export interface ShiftDeps {
  tick: (iteration: number) => Promise<TickOutcome>;
  ledger: BudgetLedger;
  log: RunLog;
  journal: Journal;
  maxIterations: number;
  noProgressWindow: number;
}

export type StopReason = 'queue-empty' | 'cap' | 'no-progress' | 'budget';

export interface ShiftReport {
  iterations: number;
  closed: string[];
  stopped: StopReason;
}

/** The capped, guarded shift loop (spec §5.4). Never uncapped. */
export async function runShift(d: ShiftDeps): Promise<ShiftReport> {
  const closed: string[] = [];
  let iterations = 0;
  let noProgress = 0;
  let stopped: StopReason = 'cap';

  while (iterations < d.maxIterations) {
    if (d.ledger.breached()) {
      stopped = 'budget';
      break;
    }
    iterations++;
    await d.journal.append({ type: 'tick', n: iterations });
    const out = await d.tick(iterations);

    if (out.empty) {
      iterations--; // an empty probe is not a real work iteration
      stopped = 'queue-empty';
      break;
    }

    if (out.closedIds.length > 0) {
      closed.push(...out.closedIds);
      noProgress = 0;
    } else {
      noProgress++;
      if (noProgress >= d.noProgressWindow) {
        stopped = 'no-progress';
        break;
      }
    }
    await d.log.write({ kind: 'tick-done', n: iterations, closed: out.closedIds });
  }

  await d.log.write({ kind: 'clock-out', iterations, closed: closed.length, stopped });
  return { iterations, closed, stopped };
}
