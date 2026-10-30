/**
 * A REPORT HANDED IN AFTER ITS MONTH WAS SENT GOES INTO THE NEXT SHEET.
 *
 * The congregation's instruction (point 14, sent by Lionel on 30 October
 * 2026): a publisher who hands his report in late is not counted irregular;
 * his report is included in the congregation's report for the FOLLOWING month,
 * with «Число сдавших отчёт» adjusted. Lionel: the late report brings its
 * reporter, its hours and its studies along (30 October 2026).
 *
 * «Sent» is what the app kept as sent — the month's snapshot, with the people
 * behind each line. Not the 20th: a report entered on the 21st of a month the
 * secretary closed on the 22nd did go to the branch with it. So a report is
 * LATE when its month has a kept sheet and its person is not among that
 * sheet's reporters.
 *
 * Where it goes: the first month after its own that has no kept sheet yet —
 * the sheet being compiled now. Once that month is kept, the sheet remembers
 * the report under `carried`, so it is counted in exactly one sheet ever,
 * whatever is reopened and closed again afterwards.
 */

/** The carried report's key: whose, for which month — card id and YYYY-MM. */
export function carryKey(publisherId: string, month: string): string {
  return `${publisherId}@${month.slice(0, 7)}`;
}

/** The card id inside a carried key. */
export function carryKeyPublisher(key: string): string {
  return key.split('@')[0];
}

/** What a kept monthly sheet says about whom it counted. */
export interface KeptSheet {
  /**
   * People whose report of that month was in when it was kept — counted on a
   * line, or handed in as «did not share». The second matters: changing such
   * a report to «shared» afterwards is a correction of a report that was on
   * time, not a late one.
   */
  reporters: Set<string>;
  /** Late reports of earlier months this sheet took in. */
  carried: Set<string>;
}

export interface LatePlace {
  /** A report of a kept month that is not on it. */
  late: boolean;
  /** The month whose sheet takes it, YYYY-MM; null when not late. */
  into: string | null;
  /** True when that sheet is already kept with it; false while it waits. */
  kept: boolean;
}

/** YYYY-MM plus n months. */
export function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Where a report of `month` by `publisherId` belongs on the sheets.
 *
 * `sheets` holds the kept months by YYYY-MM. Searching forward is bounded:
 * a congregation keeps a sheet every month, so the first gap is near.
 */
export function placeLate(
  publisherId: string,
  month: string,
  sheets: Map<string, KeptSheet>,
): LatePlace {
  const own = sheets.get(month.slice(0, 7));
  if (!own || own.reporters.has(publisherId)) {
    return { late: false, into: null, kept: false };
  }
  const key = carryKey(publisherId, month);
  for (const [period, sheet] of sheets) {
    if (period > month.slice(0, 7) && sheet.carried.has(key)) {
      return { late: true, into: period, kept: true };
    }
  }
  let into = addMonth(month.slice(0, 7), 1);
  for (let i = 0; i < 36 && sheets.has(into); i++) into = addMonth(into, 1);
  return { late: true, into, kept: false };
}

/** The kept monthly sheets of a congregation, as placeLate reads them. */
export function keptSheetsOf(
  rows: { period: string; members: Record<string, string[]> | null }[],
): Map<string, KeptSheet> {
  const out = new Map<string, KeptSheet>();
  for (const row of rows) {
    const members = row.members ?? {};
    const reporters = new Set<string>();
    // `filed` is every report that was in; sheets kept before it existed
    // know only the counted ones.
    for (const [line, ids] of Object.entries(members)) {
      if (line.startsWith('reported:') || line === 'filed') {
        ids.forEach((id) => reporters.add(id));
      }
    }
    out.set(row.period.slice(0, 7), {
      reporters,
      carried: new Set(members.carried ?? []),
    });
  }
  return out;
}
