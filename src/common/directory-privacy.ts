import { In, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from './enums/responsibility-type.enum';
import { UserRole } from './enums/user-role.enum';

/**
 * What the speakers' directory tells somebody who does not keep it.
 *
 * The directory — visiting speakers, the other congregations, the journal «К
 * нам / От нас» — is the public talk coordinator's working file, and it holds
 * other people's telephone numbers and his own notes about them. Its screens
 * were closed to everybody else; its DATA was not: the server checked who may
 * write and let any signed-in member read, whole (found on a copy of the live
 * data, 6 October — a publisher's own sign-in was sent every speaker's phone).
 *
 * Hidden on the screen is not the same as not sent. So the rule lives here, at
 * the server, in one place for the three lists:
 *
 *   - the elders, the administrators, the public talk coordinator and his
 *     assistant read everything, as before;
 *   - anybody else still gets the rows — names, congregations, dates and talk
 *     numbers are what the programme itself shows, and other screens resolve
 *     names from them — but without the contacts and without the notes.
 *
 * Fields are removed, not the rows, on purpose: a refusal would break any
 * screen that reads these lists for a name, and nothing personal is in a name
 * that already stands in the programme.
 */
const READER_RESPONSIBILITIES = [
  ResponsibilityType.PUBLIC_TALK_COORDINATOR,
  ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
];

export async function readsDirectoryContacts(
  user: AuthenticatedUser,
  responsibilities: Repository<Responsibility>,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) return true;
  const held = await responsibilities.count({
    where: {
      congregationId: user.congregationId,
      userId: user.id,
      type: In(READER_RESPONSIBILITIES),
    },
  });
  return held > 0;
}

interface CongregationContacts {
  contactName?: string | null;
  contactPhone?: string | null;
  note?: string | null;
}

/** Another congregation: where and when it meets, not whom to ring there. */
export function congregationWithoutContacts<T extends CongregationContacts>(
  row: T,
): T {
  return { ...row, contactName: null, contactPhone: null, note: null };
}

interface SpeakerContacts {
  phone?: string | null;
  note?: string | null;
  mergeRecord?: unknown;
  externalCongregation?: CongregationContacts | null;
}

/** A visiting speaker: who he is and what he gives, not how to reach him. */
export function speakerWithoutContacts<T extends SpeakerContacts>(row: T): T {
  return {
    ...row,
    phone: null,
    note: null,
    mergeRecord: null,
    externalCongregation: row.externalCongregation
      ? congregationWithoutContacts(row.externalCongregation)
      : row.externalCongregation,
  };
}

interface ExchangePrivate {
  note?: string | null;
  hospitalityPublisherId?: string | null;
  linkedAbsenceId?: string | null;
}

/**
 * A journal entry: who speaks where and when — the programme says as much —
 * not the coordinator's note, nor whose home the guest is invited to.
 */
export function exchangeWithoutPrivate<T extends ExchangePrivate>(row: T): T {
  return {
    ...row,
    note: null,
    hospitalityPublisherId: null,
    linkedAbsenceId: null,
  };
}
