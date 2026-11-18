/**
 * WHETHER THE OVERSEER'S WIFE IS PART OF THE WEEK (18 November 2026).
 *
 * One rule for every reader of a visit's items: when she does not come, her
 * own outings are nobody's business and «together with his wife» is simply
 * his outing. Rows of hers that are still stored — laid out by an older copy
 * of the last visit, or left from before the visit said she stays at home —
 * are not deleted here: the planner is shown them and removes them himself
 * (an undoable step). Until he does, nobody is told about them, and they are
 * neither announced nor reminded nor printed.
 *
 * Pure: rows in, rows out.
 */

export interface WifeShaped {
  forWife: boolean;
  withWife: boolean;
}

/** Does the overseer's wife come on this visit? */
export function wifeComes(visit: { coWifeComes?: boolean | null }): boolean {
  return visit.coWifeComes === true;
}

/**
 * The rows as the visit stands: unchanged when she comes; without her rows
 * and with no «together» when she does not. Copies are made only of the rows
 * that change, so an entity read back unchanged stays the same object.
 */
export function asVisited<T extends WifeShaped>(
  rows: T[],
  comes: boolean,
): T[] {
  if (comes) return rows;
  return rows
    .filter((r) => !r.forWife)
    .map((r) => (r.withWife ? { ...r, withWife: false } : r));
}

/** The rows the planner must clear when she does not come. */
export function strayWifeRows<T extends WifeShaped & { id: string }>(
  rows: T[],
  comes: boolean,
): { removed: string[]; unjoined: string[] } {
  if (comes) return { removed: [], unjoined: [] };
  return {
    removed: rows.filter((r) => r.forWife).map((r) => r.id),
    unjoined: rows.filter((r) => !r.forWife && r.withWife).map((r) => r.id),
  };
}
