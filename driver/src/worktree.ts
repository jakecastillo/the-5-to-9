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

  /**
   * The deterministic worktree path for a bead — knowable WITHOUT creating it.
   * Lets a caller schedule cleanup for a worktree before `add` runs, so a partial
   * `git worktree add` failure can still be removed (no orphan).
   */
  pathFor(beadId: string): string {
    return `${this.repoRoot}/.f9-worktrees/wt-${beadId}`;
  }

  /** Create an isolated worktree on a fresh branch off HEAD; returns its path. */
  async add(beadId: string, branch: string): Promise<string> {
    const path = this.pathFor(beadId);
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

  /**
   * Real integration: checkout `base`, then fast-forward-merge `branch`.
   * Falls back to `--no-ff` if `--ff-only` fails (e.g. the branch has diverged).
   * Throws if both strategies fail (conflict — caller should have run mergesClean first).
   */
  async merge(base: string, branch: string): Promise<void> {
    await this.exec('git', ['checkout', base], { cwd: this.repoRoot });
    try {
      await this.exec('git', ['merge', '--ff-only', branch], { cwd: this.repoRoot });
    } catch {
      try {
        await this.exec('git', ['merge', '--no-ff', branch], { cwd: this.repoRoot });
      } catch {
        throw new Error(`merge failed: ${branch} into ${base}`);
      }
    }
  }
}
