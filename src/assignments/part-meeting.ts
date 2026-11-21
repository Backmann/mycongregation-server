import { BadRequestException } from '@nestjs/common';
import { EventType } from '../common/enums/event-type.enum';
import { refusal } from '../common/errors/refusal';

/**
 * Which meeting a part of the programme belongs to, by its key — for the
 * keys that belong to one meeting only. Any other key (a song, a custom part,
 * a duty) belongs nowhere in particular and is left alone.
 *
 * Until 21 November 2026 nothing held to it: the midweek overseer could
 * create «Изучение Сторожевой башни» in the midweek meeting, out of reach of
 * the weekend's rights (rights review).
 */
const OF_MEETING: [RegExp, EventType][] = [
  [
    /^(midweek_|treasures_|spiritual_gems$|bible_reading$|apply_yourself_|living_christians_|cbs_)/,
    EventType.MIDWEEK,
  ],
  [/^(weekend_|watchtower_|public_talk)/, EventType.WEEKEND],
  [/^memorial_/, EventType.MEMORIAL],
];
const PROGRAMME = new Set<EventType>([
  EventType.MIDWEEK,
  EventType.WEEKEND,
  EventType.MEMORIAL,
]);

export function meetingOfPartKey(partKey: string): EventType | null {
  return OF_MEETING.find(([re]) => re.test(partKey))?.[1] ?? null;
}

/** Refuses a part put into a meeting it does not belong to. */
export function assertPartInItsMeeting(
  rows: { partKey?: string | null; eventType?: EventType | null }[],
): void {
  for (const r of rows) {
    if (!r.partKey || !r.eventType || !PROGRAMME.has(r.eventType)) continue;
    const own = meetingOfPartKey(r.partKey);
    if (own && own !== r.eventType)
      throw new BadRequestException(
        refusal(
          'PART_NOT_IN_MEETING',
          `${r.partKey} belongs to the ${own} meeting, not ${r.eventType}`,
          { partKey: r.partKey, meeting: own },
        ),
      );
  }
}
