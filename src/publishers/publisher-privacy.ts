import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
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
  // A special pioneer's own monthly hours — his and the elders' business.
  'pioneerMonthGoal',
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
  // Found on 6 October by asking the server with a publisher's own sign-in,
  // field by field. None of these is drawn on any screen a publisher has —
  // and that was the whole protection: they travelled with every roster row
  // and with the two leaders of every group.
  //
  // Anointed or of the other sheep: a matter between a person and God, kept
  // for the record card (S-21) and for nobody's curiosity.
  'spiritualStatus',
  // Who confirmed, who edited, who overrode a status and when — bookkeeping
  // about the elders' own work, the same kind as contactsConfirmedAt above.
  'contactsConfirmedByUserId',
  'lastEditedById',
  // Regular, irregular, inactive — worked out from the service reports, so
  // part of the S-21 record, which the branch keeps for elders (sfga §28).
  // Until 31 October 2026 every publisher saw who was irregular (decision
  // of 15 September); Lionel moved it to elders only that day. The inactive
  // are still left out of the roster altogether (publicRosterPage).
  'status',
  'statusManuallyOverridden',
  'statusOverriddenById',
  'statusOverriddenAt',
  // «Was restored on…» says a person had been removed. «Was anonymised»
  // says they asked for their data to be erased.
  'restoredAt',
  'anonymizedAt',
] as const;

/**
 * What a fellow publisher DOES get: names, the group, and what the schedules
 * are made of. Written out so that the list above is not the only one — a
 * field added to the publisher's card tomorrow belongs to neither, and
 * publisher-privacy.spec.ts fails until somebody has decided which. Before
 * this, a new field was public by default, and that is how the seven above
 * came to travel.
 */
export const ROSTER_PUBLISHER_FIELDS = [
  'id',
  'congregationId',
  'serviceGroupId',
  'firstName',
  'middleName',
  'lastName',
  'displayName',
  'gender',
  'isActive',
  'appointment',
  'pioneerType',
  'capabilities',
  'publicTalkNumbers',
  'createdAt',
  'updatedAt',
  'deletedAt',
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
/**
 * A whole roster page as everyone else sees it.
 *
 * Two rules travelled separately and drifted apart: the group endpoint left
 * students out while the publishers list did not, so the same person was
 * hidden in one place and shown in the other. They live together here now —
 * one function, both call sites.
 *
 * Students are not publishers, so they are not part of a roster as the
 * congregation reads it; the elders who look after them still see them. The
 * total follows the list, or the count would contradict what is on screen.
 */
export function publicRosterPage<
  P extends { data: T[]; total: number },
  T extends {
    appointment?: unknown;
    status?: unknown;
    serviceGroupId?: unknown;
  },
>(
  page: P,
  /**
   * Groups whose INACTIVE members stay in: the groups the reader oversees or
   * assists (Lionel, 22 October 2026 — «ответственные за группу и его
   * помощник могут видеть неактивных, но остальные возвещатели не могут»).
   * They already see those people in the group's reports.
   */
  keepInactiveIn: ReadonlySet<string> = new Set(),
): P {
  /**
   * Неактивные — тоже не для общего списка.
   *
   * Решение Лионеля 15 сентября: обычный возвещатель не должен видеть ни
   * изучающих, ни неактивных. Первое здесь было с самого начала, второго не
   * было, и брат, давно не подающий отчётов, стоял в списке наравне со всеми.
   *
   * НЕРЕГУЛЯРНЫЕ остаются — это его отдельное решение и оно верное: человек
   * служит, просто с перерывами, и на доске объявлений он есть.
   *
   * Старейшины и админы сюда не попадают: у них свой, полный список.
   */
  const visible = page.data.filter(
    (p) =>
      p.appointment !== PublisherAppointment.STUDENT &&
      (p.status !== PublisherStatus.INACTIVE ||
        (typeof p.serviceGroupId === 'string' &&
          keepInactiveIn.has(p.serviceGroupId))),
  );
  return {
    ...page,
    total: page.total - (page.data.length - visible.length),
    data: visible.map((p) => publicRosterView(p)),
  };
}

export function publicRosterView<T extends object>(publisher: T): T {
  const source = publisher as Record<string, unknown>;
  const pioneerActive = isActivePermanentPioneer(
    source.pioneerType as PioneerType | null | undefined,
    source.pioneerSince as string | null | undefined,
  );
  return { ...redactPrivateFields(publisher), pioneerActive } as T;
}

/**
 * The three things the annual report asks about — deaf, blind, in prison —
 * and the service status are for elders and admins alone (31 October 2026).
 *
 * A trusted member with canViewPrivateData sees contacts and dates, and
 * GET /publishers/:id already took these three out for him. The list, the
 * service groups and their members did not: there he got them for the whole
 * congregation. One function now, called wherever a privileged answer leaves
 * for someone who is not an elder.
 */
export const ELDERS_ONLY_PUBLISHER_FIELDS = [
  'isDeaf',
  'isBlind',
  'isImprisoned',
  // The service status too (31 October 2026): see PRIVATE_PUBLISHER_FIELDS.
  'status',
  'statusManuallyOverridden',
  'statusOverriddenById',
  'statusOverriddenAt',
] as const;

export function readsEldersOnly(role: string | undefined | null): boolean {
  return role === 'admin' || role === 'elder';
}

export function withoutEldersOnly<T>(publisher: T): T {
  if (!publisher || typeof publisher !== 'object') return publisher;
  const copy = { ...publisher } as Record<string, unknown>;
  for (const f of ELDERS_ONLY_PUBLISHER_FIELDS) delete copy[f];
  return copy as T;
}
