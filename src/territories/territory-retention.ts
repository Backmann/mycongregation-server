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
 *
 * Switched on 17 November 2026, by Lionel's decision, the first of the rules
 * to act (RetentionService.applyTerritory, nightly): on that day both
 * counted 0 on the live data — the first names go on 1 September 2027, and
 * the territory servant sees a month ahead how many.
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

/**
 * Names past their time become «—» and lose their card and who entered
 * them; the line stays — dates, method, the group's name.
 */
export async function anonymiseNamesBefore(
  ds: DataSource,
  congregationId: string,
  before: string,
): Promise<number> {
  const res = (await ds.query(
    `UPDATE territory_assignments
        SET holder_name = $3, publisher_id = NULL, created_by_user_id = NULL
      WHERE congregation_id = $1
        AND COALESCE(completed_on, returned_on) < $2
        AND (holder_name <> $3 OR publisher_id IS NOT NULL
             OR created_by_user_id IS NOT NULL)`,
    [congregationId, before, ANONYMOUS_HOLDER],
  )) as [unknown, number];
  return res[1] ?? 0;
}

/**
 * Lines past their time go — after the last day each territory was worked
 * moves onto the territory itself, so «last worked» never goes back. For a
 * joined territory only what was worked since the join counts
 * (`worked_from`), as everywhere else.
 */
export async function deleteLinesBefore(
  ds: DataSource,
  congregationId: string,
  before: string,
): Promise<number> {
  return ds.transaction(async (m) => {
    await m.query(
      `UPDATE territories t
          SET last_completed_on = x.last
         FROM (SELECT a.territory_id, max(a.completed_on) AS last
                 FROM territory_assignments a
                 JOIN territories tt ON tt.id = a.territory_id
                WHERE a.congregation_id = $1
                  AND COALESCE(a.completed_on, a.returned_on) < $2
                  AND a.completed_on IS NOT NULL
                  AND (tt.worked_from IS NULL OR a.completed_on >= tt.worked_from)
                GROUP BY a.territory_id) x
        WHERE t.id = x.territory_id
          AND t.congregation_id = $1
          AND (t.last_completed_on IS NULL OR t.last_completed_on < x.last)`,
      [congregationId, before],
    );
    const res = (await m.query(
      `DELETE FROM territory_assignments
        WHERE congregation_id = $1
          AND COALESCE(completed_on, returned_on) < $2`,
      [congregationId, before],
    )) as [unknown, number];
    return res[1] ?? 0;
  });
}
