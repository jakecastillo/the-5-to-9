import type { WorkerOutcome, WorkerSpec } from '../types.ts';
import type { WorkerAdapter } from './adapter.ts';

/** Test adapter: returns scripted outcomes by beadId. No model calls, no spend. */
export class MockAdapter implements WorkerAdapter {
  constructor(private scripts: Record<string, WorkerOutcome>) {}

  async run(spec: WorkerSpec): Promise<WorkerOutcome> {
    const out = this.scripts[spec.beadId];
    if (!out) throw new Error(`MockAdapter: no script for ${spec.beadId}`);
    return { ...out, role: spec.role };
  }
}
