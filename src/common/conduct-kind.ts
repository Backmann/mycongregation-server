import { BadRequestException } from '@nestjs/common';
import { EventType } from './enums/event-type.enum';
import { refusal } from './errors/refusal';

/**
 * WHICH MEETING IS BEING RUN (18 October 2026): conduct mode, the meeting as
 * it runs and its result were the midweek meeting's only; now the weekend
 * meeting has them too. Everything that names «the meeting» takes its kind.
 * A caller that says nothing means the midweek meeting — every app released
 * before this asks without a kind, and that is what it meant.
 */
export type ConductKind = EventType.MIDWEEK | EventType.WEEKEND;

export function conductKind(value: unknown): ConductKind {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    value === EventType.MIDWEEK
  ) {
    return EventType.MIDWEEK;
  }
  if (value === EventType.WEEKEND) return EventType.WEEKEND;
  throw new BadRequestException(
    refusal('INVALID_FIELD', 'kind must be midweek or weekend.', {
      fields: [{ field: 'kind', rules: ['isIn'] }],
    }),
  );
}

/** The programme part that names the chairman of each meeting. */
export const CHAIRMAN_PART_KEY: Record<ConductKind, string> = {
  [EventType.MIDWEEK]: 'midweek_chairman',
  [EventType.WEEKEND]: 'weekend_chairman',
};
