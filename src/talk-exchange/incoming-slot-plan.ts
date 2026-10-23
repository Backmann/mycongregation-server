/**
 * What an empty weekend public-talk line becomes from a «К нам» entry — the
 * decision of the one-off migration 1910000000000, kept OUT of the migrations
 * folder: TypeORM loads every exported function there as a migration class.
 */

export interface IncomingSlotRow {
  slot_id: string;
  slot_status: string;
  slot_talk_id: string | null;
  slot_special: boolean;
  slot_title: string | null;
  publisher_id: string | null;
  visiting_speaker_id: string | null;
  vs_name: string | null;
  vs_cong: string | null;
  speaker_name: string | null;
  speaker_congregation: string | null;
  public_talk_id: string | null;
  talk_label: string | null;
  special_theme: string | null;
}

export interface SlotPlan {
  publisherId: string | null;
  speakerName: string | null;
  speakerCongregation: string | null;
  visitingSpeakerId: string | null;
  publicTalkId: string | null;
  partTitle: string | null;
  specialTalk: boolean;
}

/**
 * What the line becomes, or null when it stays as it is. The same decision
 * applyIncomingToProgram makes for an empty line (overwrite = false).
 */
export function planSlot(r: IncomingSlotRow): SlotPlan | null {
  // Somebody named already — the query keeps those out, said here too.
  const theme = r.special_theme?.trim() || null;
  let speakerName: string | null = null;
  let speakerCongregation: string | null = null;
  if (!r.publisher_id) {
    if (r.vs_name?.trim()) {
      speakerName = r.vs_name.trim();
      speakerCongregation = r.vs_cong?.trim() || null;
    } else if (r.speaker_name?.trim()) {
      speakerName = r.speaker_name.trim();
      speakerCongregation = r.speaker_congregation?.trim() || null;
    }
  }
  const hasSpeaker = !!r.publisher_id || !!speakerName;
  const hasTalk = !!r.public_talk_id || !!theme;
  if (!hasSpeaker && !hasTalk) return null;

  const slotHasTalk = !!r.slot_talk_id || r.slot_special;
  let publicTalkId = r.slot_talk_id;
  let partTitle = r.slot_title;
  let specialTalk = r.slot_special;
  if (hasTalk) {
    const same = theme
      ? r.slot_special && (r.slot_title ?? '').trim() === theme
      : !r.slot_special && r.slot_talk_id === r.public_talk_id;
    // Another talk already in the line: somebody chose it.
    if (slotHasTalk && !same) return null;
    if (theme) {
      publicTalkId = null;
      partTitle = theme;
      specialTalk = true;
    } else {
      publicTalkId = r.public_talk_id;
      partTitle = r.talk_label ?? r.slot_title;
      specialTalk = false;
    }
  }
  if (!hasSpeaker) {
    // A theme with nobody yet: the talk goes in, the line stays unnamed.
    if (slotHasTalk) return null;
  }

  return {
    publisherId: r.publisher_id,
    speakerName: r.publisher_id ? null : speakerName,
    speakerCongregation: r.publisher_id ? null : speakerCongregation,
    visitingSpeakerId:
      r.publisher_id || !speakerName ? null : (r.visiting_speaker_id ?? null),
    publicTalkId,
    partTitle,
    specialTalk,
  };
}
