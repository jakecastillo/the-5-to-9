import type { ExecFn } from './exec.ts';
import type { Bead } from './types.ts';
import type { WriteQueue } from './write-queue.ts';

/**
 * Typed bd-CLI adapter (spec §8). Reads run directly; ALL writes funnel through the
 * single-writer WriteQueue (spec §3.2) — this object is the only caller of `bd` write verbs.
 */
export class Beads {
  constructor(
    private exec: ExecFn,
    private queue: WriteQueue,
    private cwd?: string,
  ) {}

  private async json<T>(args: string[]): Promise<T> {
    const { stdout } = await this.exec('bd', [...args, '--json'], { cwd: this.cwd });
    return JSON.parse(stdout || 'null') as T;
  }

  // ---- reads (bypass the queue) ----
  ready(): Promise<Bead[]> {
    return this.json<Bead[] | null>(['ready']).then((r) => r ?? []);
  }
  show(id: string): Promise<Bead> {
    return this.json<Bead>(['show', id]);
  }

  // ---- writes (serialized through the queue; the ONLY write path) ----
  create(args: string[]): Promise<void> {
    return this.queue.run(async () => {
      await this.exec('bd', ['create', ...args], { cwd: this.cwd });
    });
  }
  claim(id: string): Promise<void> {
    return this.queue.run(async () => {
      await this.exec('bd', ['update', id, '--claim'], { cwd: this.cwd });
    });
  }
  note(id: string, text: string): Promise<void> {
    return this.queue.run(async () => {
      await this.exec('bd', ['note', id, text], { cwd: this.cwd });
    });
  }
  close(id: string, reason: string): Promise<void> {
    return this.queue.run(async () => {
      await this.exec('bd', ['close', id, '--reason', reason], { cwd: this.cwd });
    });
  }
}
