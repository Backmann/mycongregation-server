/**
 * Fields on a Publisher that are private (encrypted contacts, free-text notes,
 * personal dates, and removal details such as the disfellowshipping reason).
 * They are visible only to admins and elders (and, in future, a ministerial
 * servant explicitly granted access). For everyone else the roster is
 * name-and-scheduling only, so the directory cannot be used to harvest
 * personal data.
 */
export const PRIVATE_PUBLISHER_FIELDS = [
  'mobilePhone',
  'email',
  'address',
  'spiritualNotes',
  'notes',
  'removedNote',
  'birthDate',
  'baptismDate',
  'ministryStartDate',
  'pioneerSince',
  'removalReason',
  'removedAt',
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
