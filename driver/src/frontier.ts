import type { Bead } from './types.ts';

export interface FrontierOpts {
  k: number;
  /** Dirs treated as shared interfaces; at most one selected bead may touch any of these. */
  interfaceDirs?: string[];
}

/**
 * Maximal write-independent set of ready beads to run in parallel (spec §5.2).
 * Layered: (a) touch-set (inScopeDirs) disjointness; (b) interface barrier; (c) a bead with
 * unknown scope runs SOLO — the K=1 fallback when independence can't be proven.
 * `ready` is assumed priority-ordered; selection respects that order.
 */
export function independentFrontier(ready: Bead[], opts: FrontierOpts): Bead[] {
  const k = Math.max(1, opts.k);
  const interfaceDirs = new Set(opts.interfaceDirs ?? []);
  const selected: Bead[] = [];
  const usedDirs = new Set<string>();
  let usedInterface = false;

  for (const bead of ready) {
    if (selected.length >= k) break;
    const scope = bead.inScopeDirs;

    if (!scope || scope.length === 0) {
      // Unknown scope "touches everything" → must run alone. Take it only if nothing else
      // is selected yet, then stop (it monopolizes the tick).
      if (selected.length === 0) selected.push(bead);
      break;
    }

    if (scope.some((d) => usedDirs.has(d))) continue; // touch-set collision
    const touchesInterface = scope.some((d) => interfaceDirs.has(d));
    if (touchesInterface && usedInterface) continue; // interface barrier

    selected.push(bead);
    for (const d of scope) usedDirs.add(d);
    if (touchesInterface) usedInterface = true;
  }

  return selected;
}
