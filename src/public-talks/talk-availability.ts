/**
 * May this talk be given on that day?
 *
 * Three states, not two, and the third is the one that keeps catching us out:
 *
 *   - in use — nothing set
 *   - not used from a date onwards — the ordinary instruction, «начиная с
 *     1 сентября 2026 года»
 *   - not used BETWEEN two dates — set aside for a while, and it comes back
 *
 * The question is always asked about a DAY, never in general: a talk withdrawn
 * from the first of September is perfectly fine on the last Sunday of August,
 * and one set aside until December is fine in January. Answering «снята» to
 * all of them would make the app wrong twice for every time it is right.
 *
 * Kept as a pure function so the same words are used by the picker, by the
 * coordinator's log and by the weekend programme; three copies of this rule
 * would agree for a year and part company at the edge of a window.
 */
export interface TalkRestriction {
  isActive: boolean;
  retiredFrom: string | null;
  retiredUntil: string | null;
}

export type TalkAvailability =
  /** Nothing stands in the way on that day. */
  | { state: 'available' }
  /** Not to be given from `from` onwards. */
  | { state: 'withdrawn'; from: string }
  /** Not to be given between the two dates, inclusive. */
  | { state: 'paused'; from: string; until: string }
  /** Struck out of the catalogue by hand, with no date attached. */
  | { state: 'removed' };

export function talkAvailability(
  talk: TalkRestriction,
  onDate: string,
): TalkAvailability {
  const { retiredFrom, retiredUntil } = talk;

  if (retiredFrom) {
    const started = onDate >= retiredFrom;
    const ended = !!retiredUntil && onDate > retiredUntil;

    if (started && !ended) {
      return retiredUntil
        ? { state: 'paused', from: retiredFrom, until: retiredUntil }
        : { state: 'withdrawn', from: retiredFrom };
    }
    // Before it begins, or after a temporary pause has run out: usable, and
    // the screen says so by saying nothing.
    return { state: 'available' };
  }

  // No dates at all: either in use, or struck out by hand long ago.
  return talk.isActive ? { state: 'available' } : { state: 'removed' };
}

/**
 * Is the talk restricted at all, on any day?
 *
 * For lists that have no date to ask about — the catalogue itself. A talk
 * whose pause has already ended is NOT restricted; one whose pause has not
 * begun still is, because it is about to be.
 */
export function talkIsRestricted(
  talk: TalkRestriction,
  today: string,
): boolean {
  if (!talk.isActive && !talk.retiredFrom) return true;
  if (!talk.retiredFrom) return false;
  if (talk.retiredUntil && today > talk.retiredUntil) return false;
  return true;
}
