import { asVisited } from './co-visit-wife';

/**
 * The shape of the last visit week, carried to an empty one (17 November 2026).
 *
 * Not to be confused with special-events/co-visit-template.service.ts — the
 * template of the congregation's MEETINGS during a visit. This file is the
 * week of the visit itself: outings, lunches, calls.
 *
 * A real visit repeats its week: outings at 10:00 and 14:00, a lunch at
 * 12:15, a lunch box every day, a meeting with the pioneers and one with the
 * elders. In August all of it — 37 rows — was typed by hand, and the next
 * visit started again from nothing. This carries over the FORM of the week:
 * the kind, the weekday, the hour, the place, whether the wife goes on her
 * own. Never a person: who hosts, who goes along, whom a shepherding call is
 * for — those are chosen again, with the «who was last time» hint the
 * pickers already have.
 *
 * Pure: the service loads the rows and saves what this returns.
 */

export type TemplateSource = {
  kind: string;
  forWife: boolean;
  withWife: boolean;
  itemDate: string;
  startTime: string | null;
  placeKind: string | null;
  cartLocationId: string | null;
  placeText: string | null;
  note: string | null;
  sortOrder: number;
};

export type TemplateItem = {
  kind: string;
  forWife: boolean;
  withWife: boolean;
  itemDate: string;
  startTime: string | null;
  placeKind: string | null;
  cartLocationId: string | null;
  placeText: string | null;
  note: string | null;
  sortOrder: number;
};

/**
 * Notes that describe the slot, not a person: the kind of ministry of an
 * outing («по домам»), the theme of a meeting. A shepherding call's note
 * names whom it is for, a lunch's may name the family — those stay behind.
 */
const NOTE_KEPT = new Set(['field_service', 'pioneers', 'elders']);

/** ISO weekday, Monday 1 … Sunday 7, of a YYYY-MM-DD date. */
export function isoWeekday(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Every day from `from` to `to`, both included. */
export function daysOf(from: string, to: string | null): string[] {
  const out: string[] = [];
  const end = to && to >= from ? to : from;
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= end;
    d = new Date(d.getTime() + 86400000)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * The template for the target days.
 *
 * - Each item moves to the target day of the SAME weekday; one whose weekday
 *   the new visit does not have is counted in `skipped`, never pushed to
 *   another day.
 * - Left behind: document reviews (a task of the folder, not the week), and
 *   the old empty copies of the wife's lunches the screen already hides —
 *   only her own OUTINGS are hers.
 * - When the overseer's wife does not come on the new visit, her outings stay
 *   behind and «together with his wife» becomes his outing (18 November
 *   2026): the last visit's wife is not this one's.
 * - A stand that is no longer in use is not carried: the outing keeps its
 *   slot and loses only the place (`activeCartLocations`).
 */
export function templateFrom(
  source: TemplateSource[],
  targetDays: string[],
  activeCartLocations: Set<string>,
  wifeComes: boolean,
): { items: TemplateItem[]; skipped: number } {
  const byWeekday = new Map<number, string>();
  for (const d of targetDays)
    if (!byWeekday.has(isoWeekday(d))) byWeekday.set(isoWeekday(d), d);
  const items: TemplateItem[] = [];
  let skipped = 0;
  for (const s of asVisited(source, wifeComes)) {
    if (s.kind === 'document_review') continue;
    if (s.forWife && s.kind !== 'field_service') continue;
    const day = byWeekday.get(isoWeekday(s.itemDate));
    if (!day) {
      skipped += 1;
      continue;
    }
    const standGone =
      s.placeKind === 'cart_location' &&
      (!s.cartLocationId || !activeCartLocations.has(s.cartLocationId));
    // A place, like a note, is carried only where it is a public one: a
    // shepherding call's place is somebody's home (review, 18 November 2026).
    const placeKept = NOTE_KEPT.has(s.kind) && !standGone;
    items.push({
      kind: s.kind,
      forWife: s.forWife,
      withWife: s.withWife,
      itemDate: day,
      startTime: s.startTime,
      placeKind: placeKept ? s.placeKind : null,
      cartLocationId:
        placeKept && s.placeKind === 'cart_location' ? s.cartLocationId : null,
      placeText: placeKept ? s.placeText : null,
      note: NOTE_KEPT.has(s.kind) ? s.note : null,
      sortOrder: s.sortOrder,
    });
  }
  items.sort(
    (a, b) =>
      a.itemDate.localeCompare(b.itemDate) ||
      (a.startTime ?? '99').localeCompare(b.startTime ?? '99') ||
      a.sortOrder - b.sortOrder,
  );
  return { items, skipped };
}
