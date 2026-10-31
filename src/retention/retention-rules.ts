import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { Absence } from '../entities/absence.entity';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentNotice } from '../entities/assignment-notice.entity';
import { AuxPioneerApplication } from '../entities/aux-pioneer-application.entity';
import { CartWeek } from '../entities/cart-week.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { Duty } from '../entities/duty.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceRemovedDay } from '../entities/field-service-removed-day.entity';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { MemorialItem } from '../entities/memorial-item.entity';
import { PioneerMeeting } from '../entities/pioneer-meeting.entity';
import { PioneerSchool } from '../entities/pioneer-school.entity';
import { PioneerSchoolHelper } from '../entities/pioneer-school-helper.entity';
import { ProgrammeNotice } from '../entities/programme-notice.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { User } from '../entities/user.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';

/**
 * How long the server keeps what it keeps (decided 31 October 2026).
 *
 * The periods come from the branch's supplement to «Shepherd the Flock»
 * (sfga-U Ge 9/25, §19) where it names one, and from Lionel's decisions
 * where it says «do not keep» but the app needs a short memory to work:
 * assignment history is kept twelve months so the next part still goes to
 * the one who has waited longest.
 *
 * This list is the ONE place a period lives. Each rule says what it removes,
 * which line of the supplement or which decision stands behind it, and from
 * which date on. Records that will leave the server altogether (S-21, the
 * elders' meetings) are not here: they move to the elders' own devices.
 *
 * For now the rules only COUNT (see RetentionService.preview). Nothing is
 * deleted until the counts have been looked at on the live data.
 */
export type RetentionKeep = { months?: number; days?: number };

export interface DatedRule {
  kind: 'dated';
  key: string;
  /** Plain words for the preview screen and the night log. */
  what: string;
  /** The supplement's line or the decision this rests on. */
  basis: string;
  entity: EntityTarget<ObjectLiteral>;
  /** Property holding the record's own date (a 'YYYY-MM-DD' column). */
  column: string;
  keep: RetentionKeep;
  /** Extra condition, as a property → value pair. */
  only?: Record<string, string>;
  /** Rows that leave with this one through ON DELETE CASCADE. */
  cascades?: string[];
}

export interface SoftDeletedRule {
  kind: 'soft-deleted';
  key: string;
  what: string;
  basis: string;
  entity: EntityTarget<ObjectLiteral>;
  keep: RetentionKeep;
  /**
   * Why erasing may fail and must be looked at first — a foreign key that
   * RESTRICTs, or rows that reference this one and would lose their name.
   */
  caution?: string;
}

export type RetentionRule = DatedRule | SoftDeletedRule;

const SCHEDULE =
  '§19: «Расписание встреч и список назначений — хранить не следует»; ' +
  'решение 31.10.2026 — 12 месяцев, ради очерёдности';
const TWELVE_MONTHS: RetentionKeep = { months: 12 };

export const RETENTION_RULES: RetentionRule[] = [
  {
    kind: 'dated',
    key: 'assignments',
    what: 'Назначения на встречах',
    basis: SCHEDULE,
    entity: Assignment,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'duties',
    what: 'Обязанности на встречах',
    basis: SCHEDULE,
    entity: Duty,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'cleaning',
    what: 'Уборка',
    basis: SCHEDULE,
    entity: CleaningAssignment,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'field-service-meetings',
    what: 'Встречи для проповеди',
    basis: SCHEDULE,
    entity: FieldServiceMeeting,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'field-service-removed-days',
    what: 'Снятые дни встреч для проповеди',
    basis: SCHEDULE,
    entity: FieldServiceRemovedDay,
    column: 'date',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'cart-weeks',
    what: 'Недели стенда (со сменами, записями и пожеланиями)',
    basis: SCHEDULE,
    entity: CartWeek,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
    cascades: ['cart_slots', 'cart_assignments', 'cart_requests'],
  },
  {
    kind: 'dated',
    key: 'talk-exchange',
    what: 'Обмен докладчиками',
    basis: SCHEDULE,
    entity: TalkExchange,
    column: 'date',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'special-events',
    what: 'События и визиты районного (с программой визита и Вечерей)',
    basis: SCHEDULE,
    entity: SpecialEvent,
    column: 'date',
    keep: TWELVE_MONTHS,
    cascades: ['co_visit_items', 'memorial_items'],
  },
  {
    kind: 'dated',
    key: 'pioneer-meetings',
    what: 'Встречи пионеров',
    basis: SCHEDULE,
    entity: PioneerMeeting,
    column: 'date',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'pioneer-schools',
    what: 'Школы пионеров (с днями и обязанностями)',
    basis: SCHEDULE,
    entity: PioneerSchool,
    column: 'endDate',
    keep: TWELVE_MONTHS,
    cascades: ['pioneer_school_days', 'pioneer_school_duties'],
  },
  {
    kind: 'dated',
    key: 'assignment-notices',
    what: 'Извещения о назначениях',
    basis: SCHEDULE,
    entity: AssignmentNotice,
    column: 'meetingDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'programme-notices',
    what: 'Рассылки о программе',
    basis: SCHEDULE,
    entity: ProgrammeNotice,
    column: 'weekStartDate',
    keep: TWELVE_MONTHS,
  },
  {
    kind: 'dated',
    key: 'absences',
    what: 'Отсутствия',
    basis: 'Решение 31.10.2026 — месяц после окончания',
    entity: Absence,
    column: 'endDate',
    keep: { months: 1 },
  },
  {
    kind: 'dated',
    key: 'attendance',
    what: 'Посещаемость встреч',
    basis:
      '§19: S-88 — не меньше 13 и не больше 36 месяцев; решение 31.10.2026 — 36',
    entity: MeetingAttendance,
    column: 'date',
    keep: { months: 36 },
  },
  {
    kind: 'dated',
    key: 'aux-applications',
    what: 'Рассмотренные заявления на подсобное пионерское служение (S-205b)',
    basis: '§19: «Заявления и анкеты — хранить не следует»',
    entity: AuxPioneerApplication,
    // Once approved the application has done its work: the months it asked
    // for live on as auxiliary-pioneer periods. A week's grace, so a slip of
    // the finger can still be seen and put right.
    column: 'approvedAt',
    keep: { days: 7 },
    only: { status: 'approved' },
    cascades: ['aux_pioneer_application_seats'],
  },

  // «Deleted» rows stay in the table so a deletion can be undone. After
  // thirty days the undo window is over and the row goes for good
  // (decision of 31 October 2026).
  ...(
    [
      [Assignment, 'assignments'],
      [Absence, 'absences'],
      [CoVisitItem, 'co-visit-items'],
      [ExternalCongregation, 'external-congregations'],
      [LocalNeedsTopic, 'local-needs-topics'],
      [MemorialItem, 'memorial-items'],
      [PioneerMeeting, 'pioneer-meetings'],
      [PioneerSchool, 'pioneer-schools'],
      [PioneerSchoolHelper, 'pioneer-school-helpers'],
      [ServiceGroup, 'service-groups'],
      [ServiceReport, 'service-reports'],
      [SpecialEvent, 'special-events'],
      [TalkExchange, 'talk-exchange'],
      [VisitingSpeaker, 'visiting-speakers'],
    ] as const
  ).map(
    ([entity, key]): SoftDeletedRule => ({
      kind: 'soft-deleted',
      key: `deleted:${key}`,
      what: 'Удалённые записи',
      basis: 'Решение 31.10.2026 — окончательно стирать через 30 дней',
      entity,
      keep: { days: 30 },
    }),
  ),
  {
    kind: 'soft-deleted',
    key: 'deleted:publishers',
    what: 'Удалённые карточки возвещателей',
    basis: 'Решение 31.10.2026 — окончательно стирать через 30 дней',
    entity: Publisher,
    keep: { days: 30 },
    caution:
      'Отчёты о служении и встречи пионеров не дают удалить карточку ' +
      '(RESTRICT): сначала они уходят по своим срокам',
  },
  {
    kind: 'soft-deleted',
    key: 'deleted:users',
    what: 'Удалённые учётные записи',
    basis: 'Решение 31.10.2026 — окончательно стирать через 30 дней',
    entity: User,
    keep: { days: 30 },
    caution:
      'На запись ссылаются «кто внёс» в отчётах, посещаемости и закрытиях ' +
      'месяца — при стирании там останется пусто',
  },
];

/** `today` minus the period, as 'YYYY-MM-DD'. Month ends clamp (31 Mar − 1 month = 28/29 Feb). */
export function cutoffDate(today: string, keep: RetentionKeep): string {
  const [y, m, d] = today.split('-').map(Number);
  const months = keep.months ?? 0;
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(year, month - 1, Math.min(d, lastDay)));
  shifted.setUTCDate(shifted.getUTCDate() - (keep.days ?? 0));
  return shifted.toISOString().slice(0, 10);
}
