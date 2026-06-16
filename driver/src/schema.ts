import type { Validated, WorkerOutcome } from './types.ts';

const ROLES = new Set(['owner', 'pitboss', 'dealer', 'auditor', 'eye', 'cage', 'floorman']);
const STATUSES = new Set(['done', 'failed', 'blocked']);

/** Zero-dependency runtime validator for a worker's structured JSON outcome (§3.1 schema-validated join). */
export function validateWorkerOutcome(x: unknown): Validated<WorkerOutcome> {
  if (typeof x !== 'object' || x === null) return { ok: false, error: 'not an object' };
  const o = x as Record<string, unknown>;
  if (typeof o.beadId !== 'string' || !o.beadId) return { ok: false, error: 'beadId required' };
  if (typeof o.role !== 'string' || !ROLES.has(o.role)) return { ok: false, error: 'invalid role' };
  if (typeof o.status !== 'string' || !STATUSES.has(o.status))
    return { ok: false, error: 'invalid status' };
  if (typeof o.summary !== 'string') return { ok: false, error: 'summary required' };
  if (!Array.isArray(o.filesTouched) || !o.filesTouched.every((f) => typeof f === 'string')) {
    return { ok: false, error: 'filesTouched must be string[]' };
  }
  if (typeof o.costUsd !== 'number' || Number.isNaN(o.costUsd)) {
    return { ok: false, error: 'costUsd must be a number' };
  }
  return { ok: true, value: o as unknown as WorkerOutcome };
}
