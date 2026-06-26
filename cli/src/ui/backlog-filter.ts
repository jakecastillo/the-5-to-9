/**
 * Single source of truth for the backlog id/title/status filter predicate.
 * Imported by both BacklogPane (rendering) and App (flatBeadIds memo) so the
 * two copies can never silently diverge.
 */

/** A minimal bead shape sufficient for filter evaluation. */
export interface FilterableBead {
  id: string;
  title: string;
  status?: string | null;
}

/**
 * Returns true when `bead` matches `query` on any of id / title / status
 * (case-insensitive substring). An empty query always matches.
 */
export function matchesFilter(bead: FilterableBead, query: string): boolean {
  if (query === '') return true;
  const hay = `${bead.id} ${bead.title} ${bead.status ?? ''}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}
