import { PioneerType } from './enums/pioneer-type.enum';

/**
 * Whether a publisher is an *active* permanent pioneer (regular/special/
 * missionary) in a given month — i.e. they have a pioneer type AND their
 * pioneer start month has arrived.
 *
 * A future pioneerSince (e.g. "regular pioneer from August" while it is July)
 * means they are NOT yet a pioneer: until that month they remain whatever they
 * currently are (an auxiliary pioneer, or an ordinary publisher). This keeps
 * the badge, report form, circuit-overseer pioneer meeting, and hour goal all
 * consistent with reality.
 *
 * @param monthIso  Any date in the month to test ("YYYY-MM-DD" or Date).
 */
export function isActivePermanentPioneer(
  pioneerType: PioneerType | null | undefined,
  pioneerSince: string | null | undefined,
  monthIso: string | Date = new Date(),
): boolean {
  if (!pioneerType || pioneerType === PioneerType.NONE) return false;
  if (!pioneerSince) return true; // type set, no start date → treat as active
  const monthKey =
    typeof monthIso === 'string'
      ? monthIso.slice(0, 7)
      : `${monthIso.getUTCFullYear()}-${String(
          monthIso.getUTCMonth() + 1,
        ).padStart(2, '0')}`;
  const sinceKey = pioneerSince.slice(0, 7);
  return sinceKey <= monthKey;
}

/** One period of permanent pioneer service, as the table stores it. */
export interface PioneerSpellLike {
  pioneerType: PioneerType;
  /** YYYY-MM-01. */
  startMonth: string;
  /** YYYY-MM-01, or null while the spell is still running. */
  endMonth: string | null;
}

/**
 * What kind of permanent pioneer somebody was IN A GIVEN MONTH.
 *
 * The question forty places in this codebase ask today is «what is he now»,
 * answered from two fields on the card. That is the right answer for a badge
 * and the wrong one for anything historical: a brother who pioneered from 2019
 * to 2023 reads as an ordinary publisher for every month of it, so his hours
 * cannot be entered, the monthly figures count him in the wrong line, and the
 * pioneer year measures him from nowhere.
 *
 * Spells answer it properly, and a person who pioneered twice is simply two
 * rows. Returns NONE when no spell covers the month.
 */
export function pioneerTypeInMonth(
  spells: PioneerSpellLike[],
  monthIso: string | Date,
): PioneerType {
  const monthKey =
    typeof monthIso === 'string'
      ? monthIso.slice(0, 7)
      : `${monthIso.getUTCFullYear()}-${String(
          monthIso.getUTCMonth() + 1,
        ).padStart(2, '0')}`;
  for (const s of spells) {
    if (s.startMonth.slice(0, 7) > monthKey) continue;
    if (s.endMonth && s.endMonth.slice(0, 7) < monthKey) continue;
    return s.pioneerType;
  }
  return PioneerType.NONE;
}

/** Convenience: was he ANY kind of permanent pioneer that month. */
export function wasPermanentPioneerInMonth(
  spells: PioneerSpellLike[],
  monthIso: string | Date,
): boolean {
  return pioneerTypeInMonth(spells, monthIso) !== PioneerType.NONE;
}
