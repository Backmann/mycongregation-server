import { BadRequestException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { refusal } from '../common/errors/refusal';
import { Gender } from '../common/enums/gender.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';

/**
 * The midweek meeting's own guidelines, as rules (Lionel, 20 November 2026:
 * «если что-то расходится, то стоит сделать так, как указано»). Paragraph
 * numbers are those of the guidelines for the «Жизнь и служение» meeting.
 *
 * These are the rules that hold whatever the congregation has marked on its
 * cards. The marks (capabilities) are the council's own narrowing on top:
 * the app offers by them; the server does not second-guess them.
 *
 * The app keeps the same rules for its pickers (app/lib/meeting-guidelines.ts)
 * and the same examples of titles (meeting-guidelines.fixtures.json), which
 * the app's gate compares with this repository's copy.
 */

/** What a part of «Оттачиваем навыки служения» is, read off its title. */
export type MinistryKind =
  | 'start' //   «Начинайте разговор» — п. 7
  | 'follow' //  «Развивайте интерес» — п. 8
  | 'disciples' // «Подготавливайте учеников» — п. 10
  | 'explain' // «Объясняйте свои взгляды» as a demonstration — п. 11
  | 'talk' //    a student talk, «Речь», or «Объясняйте» as a talk — п. 11, 12
  | 'discussion' // led by an elder or servant, not a student part — п. 6, 9
  | 'unknown';

const has = (t: string, re: RegExp) => re.test(t);

/**
 * The kind of a ministry part from its title. Russian, German and English
 * headings: a rule that read Russian only would fall silent on any other
 * workbook. The import writes «<heading>: <first note>», and the FIRST
 * sentence of the note decides the delivery — «Речь.» makes «Объясняйте свои
 * взгляды» a talk, «Обсуждение.» makes any heading a discussion. Only that
 * sentence is read: «… О чём идёт речь в Библии» further on is no talk
 * (review of 20 November 2026), and quotes, brackets and dashes around the
 * word do not hide it.
 */
export function ministryKind(title: string | null | undefined): MinistryKind {
  const t = (title ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  // «<heading>: <note>» as the import writes it; an older hand-typed
  // «<heading>. <note>» is read the same way.
  const colonAt = t.indexOf(':');
  const colon = colonAt >= 0 ? colonAt : t.indexOf('.');
  const heading = (colon < 0 ? t : t.slice(0, colon)).trim();
  const note = colon < 0 ? '' : t.slice(colon + 1).trim();
  const bare = (x: string) =>
    x
      .replace(/[«»"„“”()[\]—–-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const first = bare(note.split(/[.!?;]/u)[0] ?? '');
  const head = bare(heading);
  const is = (re: RegExp) => re.test(first) || re.test(head);
  if (is(/^(?:обсуждение|besprechung|discussion)(?:\s|$)/u))
    return 'discussion';
  if (is(/^(?:речь|vortrag|talk)(?:\s|$)/u)) return 'talk';
  if (
    has(head, /начина\S* разговор|gespräch beginnen|starting a conversation/u)
  )
    return 'start';
  if (has(head, /развива\S* интерес|interesse fördern|following up/u))
    return 'follow';
  if (has(head, /подготавлива\S* учеников|jünger machen|making disciples/u))
    return 'disciples';
  if (
    has(
      head,
      /объясня\S* свои взгляды|glaubensansichten erklären|explaining your beliefs/u,
    )
  )
    return 'explain';
  return 'unknown';
}

/** «Местные потребности» — only an elder gives it (п. 16). */
export function isLocalNeeds(title: string | null | undefined): boolean {
  const t = (title ?? '').toLowerCase();
  return /местные потребности|örtliche bedürfnisse|local needs/u.test(t);
}

/** The capability that approves a student for this kind of part. */
export function studentCapability(
  partKey: string,
  title: string | null | undefined,
): string | null {
  if (partKey === 'bible_reading') return 'bible_reading';
  if (!partKey.startsWith('apply_yourself_')) return null;
  switch (ministryKind(title)) {
    case 'start':
      return 'fs_starting_conversation';
    case 'follow':
      return 'fs_following_up';
    case 'disciples':
      return 'fs_making_disciples';
    case 'explain':
      return 'fs_explaining_beliefs';
    case 'talk':
      return 'fs_talk';
    default:
      return null;
  }
}

export interface GuidelinePerson {
  gender: Gender | string | null;
  appointment: PublisherAppointment | string | null;
  capabilities?: Record<string, boolean> | null;
}

export type GuidelineRefusal =
  | 'PART_NEEDS_BROTHER'
  | 'PART_NEEDS_ELDER'
  | 'PART_NEEDS_ELDER_OR_SERVANT'
  | 'PART_NO_ASSISTANT'
  | 'ASSISTANT_SAME_GENDER'
  | 'STUDENT_NOT_APPROVED';

const ELDER_OR_SERVANT = new Set<string>([
  PublisherAppointment.ELDER,
  PublisherAppointment.MINISTERIAL_SERVANT,
]);

/** Parts given to an elder or a ministerial servant (п. 3, 4, 6, 9, 16, 17, 25). */
const ELDER_OR_SERVANT_PARTS = new Set([
  'midweek_chairman',
  'treasures_talk',
  'spiritual_gems',
  'cbs_conductor',
]);

/**
 * What the guidelines say against putting these people on this part, or null.
 *
 * `checkLead` / `checkAssistant` say who is NEW on the record: a save that
 * keeps the people it had (a time, a note, a title) is never refused, so a
 * part set up before these rules can still be edited (Lionel, 20 November
 * 2026 — the live programme had no case against them, but the rule must not
 * lock what it did not write).
 */
export function guidelineRefusal(
  partKey: string,
  title: string | null | undefined,
  lead: GuidelinePerson | null,
  assistant: GuidelinePerson | null,
  checkLead = true,
  checkAssistant = true,
  localNeeds = false,
): GuidelineRefusal | null {
  const brother = (p: GuidelinePerson) => p.gender !== Gender.SISTER;
  const appt = (p: GuidelinePerson) => String(p.appointment ?? '');

  if (partKey === 'bible_reading') {
    if (lead && checkLead && !brother(lead)) return 'PART_NEEDS_BROTHER';
  }
  if (ELDER_OR_SERVANT_PARTS.has(partKey)) {
    if (lead && checkLead && !ELDER_OR_SERVANT.has(appt(lead)))
      return 'PART_NEEDS_ELDER_OR_SERVANT';
  }
  if (partKey.startsWith('living_christians')) {
    if (lead && checkLead) {
      if (localNeeds || isLocalNeeds(title)) {
        if (appt(lead) !== PublisherAppointment.ELDER)
          return 'PART_NEEDS_ELDER';
      } else if (!ELDER_OR_SERVANT.has(appt(lead))) {
        return 'PART_NEEDS_ELDER_OR_SERVANT';
      }
    }
  }
  if (partKey.startsWith('apply_yourself_')) {
    const kind = ministryKind(title);
    if (kind === 'discussion') {
      if (lead && checkLead && !ELDER_OR_SERVANT.has(appt(lead)))
        return 'PART_NEEDS_ELDER_OR_SERVANT';
      if (assistant && checkAssistant) return 'PART_NO_ASSISTANT';
    } else if (kind === 'talk') {
      if (lead && checkLead && !brother(lead)) return 'PART_NEEDS_BROTHER';
      if (assistant && checkAssistant) return 'PART_NO_ASSISTANT';
    } else if (lead && assistant && (checkLead || checkAssistant)) {
      // п. 7, 11: the same gender or one of the family — the family is the
      // elder's own word in the app, kept nowhere (Lionel, 20 November 2026).
      // п. 8, 10, and a part whose kind is not known: the same gender only.
      const familyAllowed = kind === 'start' || kind === 'explain';
      if (
        !familyAllowed &&
        lead.gender &&
        assistant.gender &&
        lead.gender !== assistant.gender
      )
        return 'ASSISTANT_SAME_GENDER';
    }
  }
  // п. 1: one who is not yet a publisher takes a student part once approved;
  // the approval is the mark of that part on his card (Lionel, 20 November).
  const cap = studentCapability(partKey, title);
  const unapproved = (p: GuidelinePerson | null, check: boolean) =>
    !!p &&
    check &&
    appt(p) === PublisherAppointment.STUDENT &&
    (!cap || !p.capabilities?.[cap]);
  if (
    (partKey === 'bible_reading' || partKey.startsWith('apply_yourself_')) &&
    (unapproved(lead, checkLead) || unapproved(assistant, checkAssistant))
  )
    return 'STUDENT_NOT_APPROVED';
  return null;
}

export interface GuidelineRow {
  partKey: string;
  partTitle?: string | null;
  publisherId?: string | null;
  assistantPublisherId?: string | null;
  /** The people the row already held: they are not checked again. */
  prevPublisherId?: string | null;
  prevAssistantPublisherId?: string | null;
  /** The row's id, when it exists: a part holding a local-needs topic. */
  id?: string | null;
}

/**
 * Refuse a save that puts someone NEW on a part against the guidelines.
 * The refusal names a rule, never a person's standing.
 */
export async function assertGuidelines(
  manager: EntityManager | undefined,
  congregationId: string,
  rows: GuidelineRow[],
): Promise<void> {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.publisherId, r.assistantPublisherId])
        .filter((x): x is string => !!x),
    ),
  ];
  if (ids.length === 0) return;
  // Specs that build a service by hand give it a repository without a
  // manager; a real one always has it.
  if (typeof manager?.getRepository !== 'function') return;
  const people = await manager.getRepository(Publisher).find({
    where: { congregationId, id: In(ids) },
    select: ['id', 'gender', 'appointment', 'capabilities'],
    withDeleted: true,
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  // A topic placed from «Местные потребности» renames its part after the
  // topic, so the heading is gone from the title: the binding tells it.
  const bound = new Set<string>();
  const partIds = rows
    .filter((r) => r.id && r.partKey.startsWith('living_christians'))
    .map((r) => r.id as string);
  if (partIds.length > 0 && typeof manager.query === 'function') {
    const found: { assignment_id: string }[] = await manager.query(
      `SELECT assignment_id FROM local_needs_uses
        WHERE congregation_id = $1 AND assignment_id = ANY($2::uuid[])`,
      [congregationId, partIds],
    );
    for (const f of found) bound.add(f.assignment_id);
  }
  for (const r of rows) {
    const lead = r.publisherId ? (byId.get(r.publisherId) ?? null) : null;
    const assistant = r.assistantPublisherId
      ? (byId.get(r.assistantPublisherId) ?? null)
      : null;
    const code = guidelineRefusal(
      r.partKey,
      r.partTitle,
      lead,
      assistant,
      !!r.publisherId && r.publisherId !== r.prevPublisherId,
      !!r.assistantPublisherId &&
        r.assistantPublisherId !== r.prevAssistantPublisherId,
      !!r.id && bound.has(r.id),
    );
    if (code)
      throw new BadRequestException(refusal(code, GUIDELINE_WORDS[code]));
  }
}

const GUIDELINE_WORDS: Record<GuidelineRefusal, string> = {
  PART_NEEDS_BROTHER:
    'By the meeting guidelines this part is given to a brother.',
  PART_NEEDS_ELDER: 'By the meeting guidelines only an elder gives this part.',
  PART_NEEDS_ELDER_OR_SERVANT:
    'By the meeting guidelines this part is given to an elder or a ministerial servant.',
  PART_NO_ASSISTANT: 'This part has no assistant.',
  ASSISTANT_SAME_GENDER:
    'By the meeting guidelines the assistant is of the same gender as the student.',
  STUDENT_NOT_APPROVED:
    'This student is not yet approved for this kind of part (mark it on the card).',
};

/**
 * The speaker of a local-needs topic is an elder (п. 16) — asked where the
 * topic gets its speaker and where it is placed with him, because the part
 * then carries the topic's title and no longer says «Местные потребности».
 */
export async function assertLocalNeedsSpeaker(
  manager: EntityManager | undefined,
  congregationId: string,
  speakerId: string | null | undefined,
  prevSpeakerId?: string | null,
): Promise<void> {
  if (!speakerId || speakerId === prevSpeakerId) return;
  if (typeof manager?.getRepository !== 'function') return;
  const p = await manager.getRepository(Publisher).findOne({
    where: { congregationId, id: speakerId },
    select: ['id', 'appointment'],
    withDeleted: true,
  });
  if (p && p.appointment !== PublisherAppointment.ELDER)
    throw new BadRequestException(
      refusal('PART_NEEDS_ELDER', GUIDELINE_WORDS.PART_NEEDS_ELDER),
    );
}
