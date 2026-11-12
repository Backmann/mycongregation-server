import type { DataSource } from 'typeorm';
import { serviceYearOf, serviceYearStart } from './service-year';

/**
 * How long the territory records keep what (12 November 2026, decided with
 * Lionel after the S-13 itself):
 *
 *  - the holder's NAME on a line of the S-13: the current and the previous
 *    service year — the form keeps no more; after that the line reads «—»
 *    and no longer points at the person's card;
 *  - the line itself — when the territory was given, due, worked or handed
 *    back, and how: five service years, so the history of a territory can
 *    still be read; the last day a territory was worked is never lost (it
 *    moves onto the territory before an old line goes).
 *
 * A territory still in someone's hands is never touched, however old.
 * For now these only COUNT (RetentionService.preview), like every rule.
 */

/** What a line shows once its name is gone. */
export const ANONYMOUS_HOLDER = '—';

/** Names on lines that ended before this day are past their time. */
export function namesKeptFrom(today: string): string {
  return serviceYearStart(serviceYearOf(today) - 1);
}

/** Lines that ended before this day are past their time. */
export function linesKeptFrom(today: string): string {
  return serviceYearStart(serviceYearOf(today) - 5);
}

/** Ended lines before `before` that still carry a name or a link to a card. */
export async function countNamedLinesBefore(
  ds: DataSource,
  congregationId: string,
  before: string,
): Promise<number> {
  const [row] = await ds.query(
    `SELECT count(*)::int AS n FROM territory_assignments
      WHERE congregation_id = $1
        AND COALESCE(completed_on, returned_on) < $2
        AND (holder_name <> $3 OR publisher_id IS NOT NULL
             OR created_by_user_id IS NOT NULL)`,
    [congregationId, before, ANONYMOUS_HOLDER],
  );
  return row.n as number;
}

/** Ended lines before `before`. */
export async function countLinesBefore(
  ds: DataSource,
  congregationId: string,
  before: string,
): Promise<number> {
  const [row] = await ds.query(
    `SELECT count(*)::int AS n FROM territory_assignments
      WHERE congregation_id = $1
        AND COALESCE(completed_on, returned_on) < $2`,
    [congregationId, before],
  );
  return row.n as number;
}
