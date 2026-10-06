/**
 * Who gives a scheduled talk, in words — for the lists that say «this talk is
 * still promised to somebody».
 *
 * A promise names its speaker in one of three ways: text the coordinator
 * typed, a link to a visiting speaker's card, or a link to one of our own
 * brothers. Only the typed text used to be read (found on a copy of the live
 * data, 6 October): every incoming line that pointed at a card came out as
 * «К нам 8 ноября: —», and the coordinator was told a talk had to be
 * rearranged without being told with whom. On the live data that was every
 * such line there was — the card is how a speaker is normally chosen.
 */
interface Named {
  speakerName?: string | null;
  speakerCongregation?: string | null;
  visitingSpeaker?: {
    firstName?: string | null;
    lastName?: string | null;
    externalCongregation?: { name?: string | null } | null;
  } | null;
  publisher?: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

const text = (value: string | null | undefined): string | null => {
  const s = (value ?? '').trim();
  return s === '' ? null : s;
};

const joined = (
  first: string | null | undefined,
  last: string | null | undefined,
): string | null => text([first, last].filter(Boolean).join(' '));

/** Typed text first — it is what the coordinator chose to call him. */
export function scheduledSpeakerName(use: Named): string | null {
  return (
    text(use.speakerName) ??
    (use.visitingSpeaker
      ? joined(use.visitingSpeaker.firstName, use.visitingSpeaker.lastName)
      : null) ??
    (use.publisher
      ? (text(use.publisher.displayName) ??
        joined(use.publisher.firstName, use.publisher.lastName))
      : null)
  );
}

export function scheduledSpeakerCongregation(use: Named): string | null {
  return (
    text(use.speakerCongregation) ??
    text(use.visitingSpeaker?.externalCongregation?.name)
  );
}
