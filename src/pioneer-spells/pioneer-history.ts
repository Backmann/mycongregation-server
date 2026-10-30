import { PioneerType } from '../common/enums/pioneer-type.enum';

/**
 * A PIONEER'S WHOLE HISTORY — what the app knows of it, and what it does not.
 *
 * The spells table began in September 2026 with ONE spell per pioneer of that
 * day, from the date on his card. Pioneering before that date — an earlier
 * stretch, years in another congregation — is on the paper S-21 and nowhere
 * here until the secretary copies it in (Lionel, 30 October 2026). So every
 * sum over the history says how far back it is known; a sum is never offered
 * as the whole when the app cannot tell.
 *
 * Regular, special and missionary months all count (Lionel, 30 October 2026:
 * «специальное и миссионерство тоже входит»). Auxiliary pioneering is kept
 * elsewhere and does not count.
 */

export const PERMANENT_KINDS: PioneerType[] = [
  PioneerType.REGULAR,
  PioneerType.SPECIAL,
  PioneerType.MISSIONARY,
];

export interface SpellLike {
  pioneerType: PioneerType | string;
  /** YYYY-MM-01 (a longer date is cut to its month). */
  startMonth: string;
  /** YYYY-MM-01, or null while it runs. */
  endMonth: string | null;
}

/** «2026-10» — the month of any date written YYYY-MM… */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Months from a to b, both inclusive; 0 when b is before a. */
export function monthsInclusive(a: string, b: string): number {
  const [ay, am] = monthOf(a).split('-').map(Number);
  const [by, bm] = monthOf(b).split('-').map(Number);
  return Math.max(0, (by - ay) * 12 + (bm - am) + 1);
}

/**
 * How many months he served as a permanent pioneer, up to and including
 * `throughMonth` — every month once, however the spells were written. A
 * spell still running counts up to `throughMonth`; a spell that starts after
 * it counts nothing.
 */
export function servedMonths(
  spells: SpellLike[],
  throughMonth: string,
): number {
  const through = monthOf(throughMonth);
  const seen = new Set<string>();
  for (const sp of spells) {
    if (!PERMANENT_KINDS.includes(sp.pioneerType as PioneerType)) continue;
    const start = monthOf(sp.startMonth);
    const end = sp.endMonth ? monthOf(sp.endMonth) : through;
    const last = end < through ? end : through;
    if (start > last) continue;
    let [y, m] = start.split('-').map(Number);
    // Bounded: a spell is at most a lifetime of months.
    for (let i = 0; i < 1200; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > last) break;
      seen.add(key);
      m += 1;
      if (m === 13) {
        m = 1;
        y += 1;
      }
    }
  }
  return seen.size;
}

/** «22 years 4 months» as numbers. */
export function yearsAndMonths(months: number): {
  years: number;
  months: number;
} {
  return { years: Math.floor(months / 12), months: months % 12 };
}

/**
 * Two ranges of months share at least one month. An open end runs forever.
 */
export function overlaps(
  a: { start: string; end: string | null },
  b: { start: string; end: string | null },
): boolean {
  const aEnd = a.end ? monthOf(a.end) : '9999-12';
  const bEnd = b.end ? monthOf(b.end) : '9999-12';
  return monthOf(a.start) <= bEnd && monthOf(b.start) <= aEnd;
}
