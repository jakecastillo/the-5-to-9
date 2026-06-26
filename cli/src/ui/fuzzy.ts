/**
 * Tiny dependency-free fuzzy matching for the command palette and did-you-mean.
 * Two jobs: rank a list by how well it matches a typed query (palette filter),
 * and find the single nearest name by edit distance (typo correction).
 */

/** Match tiers — higher is a better match. 0 means "no match". */
function score(query: string, target: string): number {
  if (query === '') return 1; // empty query matches everything (palette shows all)
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 4; // exact
  if (t.startsWith(q)) return 3; // prefix
  if (t.includes(q)) return 2; // substring
  return isSubsequence(q, t) ? 1 : 0; // in-order, non-contiguous
}

/** True when every char of `q` appears in `t` in order (not necessarily adjacent). */
function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * Filter + rank `targets` by `query`, best first. Non-matches are dropped. Ties
 * keep input order (stable) so an empty query returns the registry order intact.
 */
export function fuzzyRank(query: string, targets: string[]): string[] {
  if (query === '') return [...targets];
  return targets
    .map((t, i) => ({ t, i, s: score(query, t) }))
    .filter((e) => e.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((e) => e.t);
}

/** Levenshtein edit distance between two strings (iterative, O(a·b) space-light). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * The closest name to `query` by edit distance, or undefined when nothing is
 * within threshold (default: max(2, half the query length)). Case-insensitive.
 */
export function nearestName(
  query: string,
  names: string[],
  maxDistance = Math.max(2, Math.floor(query.length / 2)),
): string | undefined {
  const q = query.toLowerCase();
  let best: string | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const d = editDistance(q, name.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return bestD <= maxDistance ? best : undefined;
}
