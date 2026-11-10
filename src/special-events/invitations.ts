import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { PioneerType } from '../common/enums/pioneer-type.enum';
import { isActivePermanentPioneer } from '../common/pioneer-status';

/**
 * EVENTS FOR THE INVITED ONLY (10 November 2026).
 *
 * Three kinds of event concern a part of the congregation, not all of it:
 *  - the Kingdom Ministry School for elders — the elders;
 *  - the same school for ministerial servants — the ministerial servants;
 *  - the special meeting with the pioneers of the circuit — the regular and
 *    special pioneers and the missionaries.
 *
 * Only they see such an event, are told about it and find it in their
 * calendar; those who keep the events (administrators, the body
 * coordinator) see it too. Everybody else is not shown it at all — the
 * server does not send it. Those who plan the meetings learn only that the
 * invited are busy on those days (`busy`), not the event itself.
 *
 * Who is invited is decided by the kind, never by hand, and on the event's
 * own day: a brother appointed after the school was entered is invited, one
 * whose pioneering began the month after is not.
 *
 * Pure: no database — scripts and tests read it directly.
 */
export type Invitees = 'elders' | 'servants' | 'pioneers';

export const INVITE_ONLY_TYPES: Record<string, Invitees> = {
  kingdom_ministry_school_elders: 'elders',
  kingdom_ministry_school_servants: 'servants',
  pioneer_special_meeting: 'pioneers',
};

export function inviteesOf(type: string | null | undefined): Invitees | null {
  return (type && INVITE_ONLY_TYPES[type]) || null;
}

export interface InviteeCard {
  isActive: boolean;
  appointment: PublisherAppointment | string | null;
  pioneerType: PioneerType | string | null;
  pioneerSince: string | null;
}

/** Is the person on this card invited to an event of this kind on that day? */
export function isInvited(
  card: InviteeCard,
  who: Invitees,
  dateISO: string,
): boolean {
  if (!card.isActive) return false;
  switch (who) {
    case 'elders':
      return card.appointment === PublisherAppointment.ELDER;
    case 'servants':
      return card.appointment === PublisherAppointment.MINISTERIAL_SERVANT;
    case 'pioneers':
      return isActivePermanentPioneer(
        card.pioneerType as PioneerType | null,
        card.pioneerSince,
        dateISO,
      );
  }
}
