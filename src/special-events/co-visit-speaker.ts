/**
 * Who gives the public talk in the week of a circuit visit.
 *
 * The visit used to write the overseer's name into the talk slot and leave
 * everything else there as it was. If one of ours had been assigned to the
 * talk before the visit was entered, the slot then held TWO speakers: the
 * programme feed showed the overseer, the editor showed the brother, «my
 * assignments» and the evening reminders went on telling the brother to
 * prepare, and the theme of HIS talk stood under the overseer's name in the
 * journal (seen on the stand, 5 October).
 *
 * Teaching every screen to prefer the overseer would work until the next
 * screen that did not know to. So the data says it instead: while the visit
 * stands, the slot holds the overseer and nothing of the speaker before him.
 * What was there is written into the visit's undo plan and comes back, whole,
 * when the visit is taken away — the same way the Bible study does.
 *
 * Nobody has to be told by hand. The brother was told of the talk through a
 * mark the reminders keep; the mark now points at a part that is not his, and
 * the evening digest says so that same day: «Назначение отменено». If the
 * visit is cancelled, the part is his again and the digest tells him again.
 *
 * Pure, so the two halves can be tested without a database.
 */

/** Everything about the speaker a talk slot carries. */
export interface SlotSpeaker {
  publisherId: string | null;
  speakerName: string | null;
  speakerCongregation: string | null;
  visitingSpeakerId: string | null;
  publicTalkId: string | null;
  specialTalk: boolean;
  partTitle: string | null;
}

export const SPEAKER_FIELDS = [
  'publisherId',
  'speakerName',
  'speakerCongregation',
  'visitingSpeakerId',
  'publicTalkId',
  'specialTalk',
  'partTitle',
] as const satisfies readonly (keyof SlotSpeaker)[];

/** The slot as the visit leaves it: the overseer, and his talk not yet chosen. */
export function overseerInSlot(name: string): SlotSpeaker {
  return {
    publisherId: null,
    speakerName: name,
    speakerCongregation: null,
    // The mirror links the overseer's own card; the one before was another's.
    visitingSpeakerId: null,
    publicTalkId: null,
    specialTalk: false,
    partTitle: null,
  };
}

/** What the slot says of its speaker now — the part of it the visit replaces. */
export function speakerOf(slot: Partial<SlotSpeaker>): SlotSpeaker {
  return {
    publisherId: slot.publisherId ?? null,
    speakerName: slot.speakerName ?? null,
    speakerCongregation: slot.speakerCongregation ?? null,
    visitingSpeakerId: slot.visitingSpeakerId ?? null,
    publicTalkId: slot.publicTalkId ?? null,
    specialTalk: !!slot.specialTalk,
    partTitle: slot.partTitle ?? null,
  };
}

/**
 * Puts back what was remembered. Only the fields that were remembered: a
 * visit applied before this existed is mended later and by then remembers the
 * name elsewhere (its old `field` entry), so the name is not in `prev`.
 */
export function restoreSpeaker(
  slot: SlotSpeaker,
  prev: Partial<SlotSpeaker>,
): void {
  for (const f of SPEAKER_FIELDS) {
    if (f in prev) {
      (slot as unknown as Record<string, unknown>)[f] =
        prev[f] ?? (f === 'specialTalk' ? false : null);
    }
  }
}

/**
 * A visit applied before 6 October 2026 with one of ours still beneath the
 * overseer: what has to be taken off now, or null when the slot is clean.
 * The name stays out of it — the visit already remembers the name it found.
 */
export function leftBeneath(
  slot: SlotSpeaker,
  overseer: string | null,
): Partial<SlotSpeaker> | null {
  const same = (a: string | null, b: string | null) =>
    !!a &&
    !!b &&
    a.trim().replace(/\s+/g, ' ').toLowerCase() ===
      b.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!same(slot.speakerName, overseer)) return null;
  if (!slot.publisherId) return null;
  // His talk went in with him and leaves with him. A talk chosen for the
  // overseer since cannot be told apart from it here; it is remembered too,
  // so nothing is lost either way, and the slot is left for the overseer's.
  return {
    publisherId: slot.publisherId,
    publicTalkId: slot.publicTalkId,
    specialTalk: slot.specialTalk,
    partTitle: slot.partTitle,
  };
}
