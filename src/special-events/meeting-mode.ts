import { BadRequestException } from '@nestjs/common';
import type { MeetingMode } from '../entities/special-event.entity';

/**
 * Events that decide the congregation's meeting by a rule of their own — a
 * convention cancels the week, the Memorial takes one meeting by the kind of
 * day, a circuit visit moves the midweek one. They are not asked «how does the
 * meeting go»: the answer is already theirs.
 */
const OWN_RULE_TYPES = new Set([
  'regional_convention',
  'circuit_assembly',
  'memorial',
  'circuit_overseer_visit',
]);

/** Whether an event of this kind carries the three-way meeting answer. */
export function takesMeetingMode(type: string | null | undefined): boolean {
  return !OWN_RULE_TYPES.has(type ?? '');
}

export interface MeetingFields {
  type?: string | null;
  meetingMode: MeetingMode;
  meetingNote: string | null;
  meetingTime: string | null;
  meetingAddress: string | null;
  replacesMeeting: boolean;
}

export interface MeetingInput {
  meetingMode?: MeetingMode;
  meetingNote?: string | null;
  meetingTime?: string | null;
  meetingAddress?: string | null;
  replacesMeeting?: boolean;
}

const clean = (s: string | null | undefined): string | null =>
  s?.trim() ? s.trim() : null;

/**
 * The meeting answer as it will be stored, from what the event had and what
 * was sent. Pure: the caller assigns the result.
 *
 * - An app from before the three answers sends only `replacesMeeting`: «yes»
 *   is «no meeting», «no» takes back a «no meeting» and leaves «changed» be.
 * - Only «changed» keeps what changes, the hour and the place; the other two
 *   answers have nothing to say about them, and a stale hour left behind
 *   would come back the day someone picks «changed» again.
 * - «Changed» that says nothing — no words, no hour, no place — is refused:
 *   the congregation would be told «with changes» and not which.
 * - `replacesMeeting` follows «none»: the week rules read it.
 */
export function settleMeeting(
  current: MeetingFields,
  input: MeetingInput,
): Omit<MeetingFields, 'type'> {
  let mode: MeetingMode = input.meetingMode ?? current.meetingMode ?? 'usual';
  if (input.meetingMode === undefined && input.replacesMeeting !== undefined) {
    if (input.replacesMeeting) mode = 'none';
    else if (mode === 'none') mode = 'usual';
  }
  if (!takesMeetingMode(current.type)) mode = 'usual';

  const pick = <K extends 'meetingNote' | 'meetingTime' | 'meetingAddress'>(
    k: K,
  ) => clean(input[k] !== undefined ? input[k] : current[k]);

  if (mode !== 'changed') {
    return {
      meetingMode: mode,
      meetingNote: null,
      meetingTime: null,
      meetingAddress: null,
      replacesMeeting: mode === 'none',
    };
  }
  const out = {
    meetingMode: mode,
    meetingNote: pick('meetingNote'),
    meetingTime: pick('meetingTime'),
    meetingAddress: pick('meetingAddress'),
    replacesMeeting: false,
  };
  if (!out.meetingNote && !out.meetingTime && !out.meetingAddress) {
    throw new BadRequestException({
      code: 'EVENT_CHANGE_EMPTY',
      message:
        'Say what changes about the meeting: in words, its time or its place',
    });
  }
  return out;
}
