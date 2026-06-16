import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Tier-0 zero-dependency NDJSON run log (spec §10). */
export class RunLog {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  async write(record: Record<string, unknown>): Promise<void> {
    const fh = await open(this.path, 'a');
    try {
      await fh.write(`${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
    } finally {
      await fh.close();
    }
  }
}

/** Cost/token ledger + circuit breaker (spec §10). $ figures are client-side ESTIMATES. */
export class BudgetLedger {
  private usd = 0;
  private tokens = 0;

  constructor(
    private capUsd: number,
    private capTokens: number,
  ) {}

  add(usd: number, tokens = 0): void {
    this.usd += usd;
    this.tokens += tokens;
  }
  spentUsd(): number {
    return this.usd;
  }
  breached(): boolean {
    if (this.capUsd > 0 && this.usd >= this.capUsd) return true;
    if (this.capTokens > 0 && this.tokens >= this.capTokens) return true;
    return false;
  }
}
