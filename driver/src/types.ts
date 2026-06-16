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
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
