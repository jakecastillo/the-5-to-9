export type Role = 'owner' | 'pitboss' | 'dealer' | 'auditor' | 'eye' | 'cage' | 'floorman';

export interface Bead {
  id: string;
  status: string;
  /** §5.2 touch-set used to compute write-independence. */
  inScopeDirs?: string[];
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
  /**
   * An outward/irreversible command the sandboxed worker could NOT run itself and
   * is SURFACING for a human consent gate (Phase 1c). When present + flagged
   * irreversible, the orchestrator requests consent and — only on a type-to-confirm
   * APPROVE — performs this EXACT string verbatim. Optional: most outcomes omit it.
   */
  requestedAction?: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
