import { PioneerType } from '../common/enums/pioneer-type.enum';
import { isActivePermanentPioneer } from '../common/pioneer-status';

/**
 * Fields on a Publisher that are private (encrypted contacts, free-text notes,
 * personal dates, removal details such as the disfellowshipping reason, and
 * the circumstances the annual report asks about).
 * They are visible only to admins and elders (and, in future, a ministerial
 * servant explicitly granted access). For everyone else the roster is
 * name-and-scheduling only, so the directory cannot be used to harvest
 * personal data.
 */
export const PRIVATE_PUBLISHER_FIELDS = [
  'mobilePhone',
  'email',
  'address',
  'notes',
  'removedNote',
  'birthDate',
  'baptismDate',
  'ministryStartDate',
  'pioneerSince',
  'removalReason',
  'removedAt',
  // The circumstances the annual report asks about. More personal than a
  // phone number, and needed only by the elders who care for the person and
  // by whoever fills in the yearly figures.
  'isDeaf',
  'isBlind',
  'isImprisoned',
  // Secretarial bookkeeping, not roster information. Whether someone has
  // confirmed their details this year — and whether they have a login at all —
  // says nothing a fellow publisher needs and quietly exposes who is without
  // an account. Hiding the badge in the app was not enough: the facts
  // themselves should not travel.
  'contactsConfirmedAt',
  'userId',
] as const;

/**
 * Return a shallow copy of a publisher with the private fields removed. Used to
 * shape the roster for callers who may see names (for scheduling, groups) but
 * not personal data.
 */
export function redactPrivateFields<T extends object>(publisher: T): T {
  const copy = { ...publisher } as Record<string, unknown>;
  for (const field of PRIVATE_PUBLISHER_FIELDS) {
    delete copy[field];
  }
  return copy as T;
}

/**
 * The roster row as everyone else sees it: private fields gone, plus one
 * computed fact that cannot be worked out without them.
 *
 * `pioneerSince` is private, and a pioneer type with a start month still in
 * the future means the person is NOT yet a pioneer — she is whatever she is
 * today, usually an auxiliary one. Without the date the app had to guess, and
 * guessed "already serving", so a publisher was shown as a regular pioneer
 * months early. The date stays private; the answer travels instead.
 */
export function publicRosterView<T extends object>(publisher: T): T {
  const source = publisher as Record<string, unknown>;
  const pioneerActive = isActivePermanentPioneer(
    source.pioneerType as PioneerType | null | undefined,
    source.pioneerSince as string | null | undefined,
  );
  return { ...redactPrivateFields(publisher), pioneerActive } as T;
}
