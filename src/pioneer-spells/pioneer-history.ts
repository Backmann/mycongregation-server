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

// ---- Without the hours requirement (instructions, point 9) ---------------

/** The service year a day or month falls in: September opens the next one. */
export function serviceYearOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 9 ? y + 1 : y;
}

export interface NoQuotaLike {
  pioneerType: PioneerType | string;
  noQuotaDecidedOn?: string | null;
  noQuotaEndedOn?: string | null;
}

/**
 * Whether the spell is free of the hours requirement in a service year
 * (Lionel, 30 October 2026): from the year the elders decided it — the
 * whole of it — through the year it was taken back in, if ever.
 */
export function noQuotaInServiceYear(
  spell: NoQuotaLike,
  serviceYear: number,
): boolean {
  if (spell.pioneerType !== PioneerType.REGULAR || !spell.noQuotaDecidedOn) {
    return false;
  }
  if (serviceYearOf(String(spell.noQuotaDecidedOn)) > serviceYear) return false;
  return (
    !spell.noQuotaEndedOn ||
    serviceYearOf(String(spell.noQuotaEndedOn)) >= serviceYear
  );
}

/** The age of 50 the instructions name — reached on the 50th birthday. */
export const NO_QUOTA_MIN_AGE = 50;
/** Fifteen years of pioneering in all. */
export const NO_QUOTA_MIN_MONTHS = 15 * 12;

export interface NoQuotaEligibility {
  /** Full years on `today`; null without a birth date. */
  age: number | null;
  ageOk: boolean;
  /** Months of permanent pioneering the app knows of, up to this month. */
  servedMonths: number;
  yearsOk: boolean;
  /** The first month the app knows of — earlier service may be on paper. */
  knownFrom: string | null;
  /** Both conditions the app can see. Health and the wish are the elders'. */
  eligible: boolean;
}

/**
 * Points 1 and 2 of the three (point 9): 50 and older (Lionel: «с 50 можно
 * начать»), and fifteen years of regular, special or missionary pioneering in
 * all. The third — the wish to go on — and the health behind it are for the
 * elders, with the circuit overseer; nothing here judges them.
 */
export function noQuotaEligibility(
  birthDate: string | null,
  spells: SpellLike[],
  today: string,
): NoQuotaEligibility {
  let age: number | null = null;
  if (birthDate) {
    const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
    const [ty, tm, td] = today.slice(0, 10).split('-').map(Number);
    age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  }
  const served = servedMonths(spells, `${monthOf(today)}-01`);
  const known = spells
    .filter((s) => PERMANENT_KINDS.includes(s.pioneerType as PioneerType))
    .map((s) => monthOf(s.startMonth))
    .sort();
  const ageOk = age !== null && age >= NO_QUOTA_MIN_AGE;
  const yearsOk = served >= NO_QUOTA_MIN_MONTHS;
  return {
    age,
    ageOk,
    servedMonths: served,
    yearsOk,
    knownFrom: known[0] ?? null,
    eligible: ageOk && yearsOk,
  };
}

/** The elders' decision (YYYY-MM-DD) that frees this service year, or null. */
export function noQuotaDecisionIn(
  spells: NoQuotaLike[],
  serviceYear: number,
): string | null {
  const s = spells.find((sp) => noQuotaInServiceYear(sp, serviceYear));
  return s?.noQuotaDecidedOn ? String(s.noQuotaDecidedOn).slice(0, 10) : null;
}
