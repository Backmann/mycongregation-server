/**
 * What happened to the territories, read off the journal (17 November 2026):
 * the journal of one territory and «Что происходит» on the territory
 * servant's desk.
 *
 * The journal keeps facts in the shape each step wrote them; this names the
 * step. Pure, so a spec can hold it to every shape ever written — the older
 * entries carry less (no holder, no number), and the service fills those
 * from the line itself while it still exists.
 */

export type HistoryKind =
  /** Given out. */
  | 'given'
  /** Handed on to someone else through the keeper. */
  | 'transferred'
  /** A line from before the app, entered by hand. */
  | 'past'
  /** Worked through. */
  | 'worked'
  /** Handed back unworked. */
  | 'returned'
  /** Free territories worked in a campaign. */
  | 'campaign'
  /** More time. */
  | 'extended'
  /** A keeper's correction of a line. */
  | 'corrected'
  /** A line entered by mistake, removed. */
  | 'removed'
  /** The territory itself: boundary, card, held back for a join, … */
  | 'territory'
  /** Steps the desk does not show (links, printing, meetings). */
  | 'quiet';

/** The filters of the screens, each a set of kinds. */
export const HISTORY_FILTERS: Record<string, HistoryKind[]> = {
  given: ['given', 'transferred'],
  back: ['worked', 'returned', 'campaign'],
  fixes: ['corrected', 'removed', 'past'],
  territory: ['territory'],
};

/** Journal entity types of the territory section. */
export const TERRITORY_ENTITY_TYPES = [
  'territory_assignment',
  'territory',
  'territory_boundary',
  'territory_no_call',
  'territory_import',
  'territory_settings',
];

type Detail = Record<string, unknown>;

/** Steps of the re-cutting that change the territories themselves. */
const RECUT_SHOWN = ['applied', 'unapplied', 'held', 'released'];

export function historyKind(
  entityType: string,
  action: string,
  d: Detail | null,
): HistoryKind {
  if (entityType !== 'territory_assignment') {
    // «Не посещать» addresses, imports and settings are not the life of a
    // territory; the territory's own card, boundary and holds are.
    if (entityType === 'territory_boundary') return 'territory';
    if (entityType !== 'territory') return 'quiet';
    // The re-cutting draft's own work (measures, proposals, approvals) is
    // the draft's; only what reaches the territories shows here.
    const recut = d?.recut;
    if (typeof recut === 'string' && !RECUT_SHOWN.includes(recut)) {
      return 'quiet';
    }
    return 'territory';
  }
  const has = (k: string) => !!d && k in d;
  if (action === 'DELETE') return 'removed';
  if (action === 'CREATE') {
    if (has('campaign')) return 'campaign';
    if (has('transferredFrom')) return 'transferred';
    if (d?.past === true) return 'past';
    return 'given';
  }
  if (action !== 'UPDATE' || !d) return 'quiet';
  if (d.correction === true || (has('before') && has('after'))) {
    return 'corrected';
  }
  if (has('link') || has('printed') || has('meeting')) return 'quiet';
  if (has('completedOn')) return 'worked';
  if (has('returnedOn')) return 'returned';
  if (has('dueOn')) return 'extended';
  return 'quiet';
}

/** The kinds a filter asks for; unknown or empty: everything the desk shows. */
export function kindsOf(filter: string | undefined): HistoryKind[] | null {
  if (!filter) return null;
  const kinds = filter
    .split(',')
    .flatMap((f) => HISTORY_FILTERS[f.trim()] ?? [])
    .filter((k, i, all) => all.indexOf(k) === i);
  return kinds.length ? kinds : null;
}
