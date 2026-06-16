import type { ExecFn } from './exec.ts';

/**
 * Native git-worktree management + the `git merge-tree` conflict backstop (spec §5.2/§8).
 * There is no `bd worktree` subcommand — worktrees are pure git, driver-managed.
 */
export class Worktrees {
  constructor(
    private exec: ExecFn,
    private repoRoot: string,
  ) {}

  /** Create an isolated worktree on a fresh branch off HEAD; returns its path. */
  async add(beadId: string, branch: string): Promise<string> {
    const path = `${this.repoRoot}/.f9-worktrees/wt-${beadId}`;
    await this.exec('git', ['worktree', 'add', '-b', branch, path, 'HEAD'], { cwd: this.repoRoot });
    return path;
  }

  async remove(path: string): Promise<void> {
    await this.exec('git', ['worktree', 'remove', '--force', path], { cwd: this.repoRoot });
  }

  /**
   * Dry-run backstop: true iff merging `branch` into `base` is conflict-free.
   * Uses `git merge-tree --write-tree` (no working-tree writes); a nonzero exit or a
   * conflict marker in the output means a real merge would conflict.
   */
  async mergesClean(base: string, branch: string): Promise<boolean> {
    try {
      const { stdout } = await this.exec('git', ['merge-tree', '--write-tree', base, branch], {
        cwd: this.repoRoot,
      });
      return !stdout.includes('CONFLICT') && !stdout.includes('<<<<<<<');
    } catch {
      return false;
    }
  }
}
