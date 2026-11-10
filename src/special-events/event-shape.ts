import { BadRequestException } from '@nestjs/common';
import { inviteesOf } from './invitations';

/**
 * What an event must look like to be saved (27 September).
 *
 * The form always sent tidy values, so nobody noticed that the server took
 * anything: an hour written as any text up to fifty characters, an end
 * before the start, a «link» that was not one, a kind nobody knows. Each of
 * these is refused now with its own reason. Only what the save CHANGES is
 * checked — an old record with an odd hour can still have its note fixed.
 */
export const EVENT_TYPES = [
  'regional_convention',
  'circuit_assembly',
  'memorial',
  'circuit_overseer_visit',
  'branch_representative_visit',
  // A campaign of the congregation's ministry (29 October 2026): for
  // everybody to see, and with `auxReducedHours` a month where auxiliary
  // pioneers may take 15 hours. It changes no meeting.
  'campaign',
  // For the invited only (10 November 2026) — see invitations.ts.
  'kingdom_ministry_school_elders',
  'kingdom_ministry_school_servants',
  'pioneer_special_meeting',
  'other',
] as const;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LINK = /^https?:\/\/\S+$/i;

export interface EventShape {
  type?: string | null;
  time?: string | null;
  timeEnd?: string | null;
  mapUrl?: string | null;
  programUrl?: string | null;
}

const refuse = (code: string, message: string) =>
  new BadRequestException({ code, message });

const blank = (s: string | null | undefined) => !s || !s.trim();

export function assertEventShape(
  next: EventShape,
  prev: EventShape | null,
): void {
  const changed = (k: keyof EventShape) =>
    !prev || (next[k] ?? null) !== (prev[k] ?? null);

  if (changed('type') && !blank(next.type)) {
    if (next.type === 'special_talk') {
      throw refuse(
        'EVENT_SPECIAL_TALK_IN_JOURNAL',
        'A special talk is recorded in the talk log, with its speaker',
      );
    }
    if (!(EVENT_TYPES as readonly string[]).includes(next.type!)) {
      throw refuse('EVENT_TYPE_UNKNOWN', 'Unknown kind of event');
    }
  }
  // The kind of an event for the invited decides who was told about it: a
  // school for elders turned into one for servants would leave the elders
  // with a message about nothing and the servants with none (10 November
  // 2026). Such a kind is not changed, nor is another kind changed into it —
  // delete and enter it again.
  if (
    prev &&
    changed('type') &&
    (inviteesOf(prev.type) !== null || inviteesOf(next.type) !== null)
  ) {
    throw refuse(
      'EVENT_TYPE_LOCKED',
      'The kind of an event for the invited cannot be changed; delete it and enter it again',
    );
  }

  if (changed('time') || changed('timeEnd')) {
    const t = blank(next.time) ? null : next.time!.trim();
    const e = blank(next.timeEnd) ? null : next.timeEnd!.trim();
    if ((t && !HM.test(t)) || (e && !HM.test(e))) {
      throw refuse('EVENT_TIME_INVALID', 'The time is written as HH:mm');
    }
    if (e && !t) {
      throw refuse('EVENT_TIME_ORDER', 'An end time needs a start time');
    }
    if (t && e && e <= t) {
      throw refuse('EVENT_TIME_ORDER', 'The event must end after it starts');
    }
  }

  for (const k of ['mapUrl', 'programUrl'] as const) {
    if (changed(k) && !blank(next[k]) && !LINK.test(next[k]!.trim())) {
      throw refuse('EVENT_LINK_INVALID', 'A link starts with https://');
    }
  }
}

/** September to August, named by the year it starts in. */
export function serviceYearOf(dateISO: string): number {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  return m >= 9 ? y : y - 1;
}
