/**
 * Which fields of which kind of record can be put back — and nothing else.
 *
 * A plain constant with no imports on purpose. Two very different places need
 * it: the revert service, which applies it, and the journal list, which has to
 * tell the app whether to offer the button at all. Were this knowledge kept
 * inside the revert service, the journal would have to import that service —
 * and the revert service imports every feature module, each of which imports
 * the journal's own module to write history. A circle. A constant has no
 * dependencies, so it can be read from both sides.
 *
 * A field is here because putting an old value back into it is meaningful on
 * its own. Identity, ownership, computed status and anything a second table
 * leans on are left out. Kinds absent from this map are refused outright: a
 * report is a regulated document with its own closing rules, a duty and a
 * cleaning week are set by their own assign methods rather than a partial
 * edit, and users hold roles and passwords.
 */
export const REVERTABLE_FIELDS: Record<string, string[]> = {
  assignment: [
    'partTitle',
    'partNotes',
    'assigneePublisherId',
    'assistantPublisherId',
    'startTime',
    'durationMinutes',
    'songNumber',
  ],
  local_need: ['title', 'notes', 'speakerPublisherId', 'usedWeek'],
  absence: ['startDate', 'endDate', 'reason', 'note'],
  hall: ['name', 'address'],
  publisher: [
    'firstName',
    'lastName',
    'gender',
    'appointment',
    'serviceGroupId',
    'baptismDate',
    'birthDate',
    'ministryStartDate',
    'pioneerType',
    'pioneerSince',
    'notes',
  ],
  service_group: ['name', 'overseerPublisherId', 'assistantPublisherId'],
  cart_location: ['name', 'address', 'note', 'mapUrl'],
  circuit_overseer: [
    'firstName',
    'lastName',
    'wifeName',
    'phone',
    'email',
    'note',
  ],
  external_congregation: [
    'name',
    'city',
    'address',
    'mapUrl',
    'contactName',
    'contactPhone',
    'note',
  ],
  special_event: ['title', 'startDate', 'endDate', 'note'],
  pioneer_school: [
    'title',
    'startDate',
    'endDate',
    'hallName',
    'hallAddress',
    'startTime',
    'endTime',
    'microphoneSlots',
    'notes',
  ],
  co_visit_item: [
    'itemDate',
    'startTime',
    'placeKind',
    'placeText',
    'cartLocationId',
    'note',
  ],
};

/**
 * Whether an entry is worth offering a revert for, judged from the entry alone.
 *
 * The same three questions the revert service asks — is it an edit, are its
 * values still there, does it touch a field that can come back — so the button
 * appears exactly where it will work.
 */
export function isRevertable(
  action: string,
  entityType: string,
  redacted: boolean,
  changedFields: string[],
): boolean {
  if (action !== 'UPDATE' || redacted) return false;
  const allowed = REVERTABLE_FIELDS[entityType];
  if (!allowed) return false;
  return changedFields.some((f) => allowed.includes(f));
}
