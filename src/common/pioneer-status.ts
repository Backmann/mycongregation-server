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
