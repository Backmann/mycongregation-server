import { IsNull } from 'typeorm';
import type {
  DataSource,
  EntityTarget,
  FindOperator,
  ObjectLiteral,
} from 'typeorm';
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
import { TerritoryRequest } from '../entities/territory-request.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import {
  anonymiseNamesBefore,
  countLinesBefore,
  countNamedLinesBefore,
  deleteLinesBefore,
  countClosedRequestsBefore,
  deleteClosedRequestsBefore,
  requestsKeptFrom,
  linesKeptFrom,
  namesKeptFrom,
} from '../territories/territory-retention';
import { User } from '../entities/user.entity';
import { MeetingAnnouncement } from '../entities/meeting-announcement.entity';
import { keptFromWeek } from '../announcements/announcement-rights';
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
  /**
   * A row whose `column` is empty is dated by this property instead (an
   * absence without an end is one day long: it ends on its start).
   */
  emptyMeans?: string;
  /** Rows that leave with this one through ON DELETE CASCADE. */
  cascades?: string[];
  /**
   * Switched on: removed every night, not only counted (R-20, 28 November
   * 2026: switched on one by one, each once its counts were seen).
   */
  on?: true;
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
  /**
   * What still holds the row, whatever its age: the row stays while this
   * says so (property → operator, joined with AND to the age).
   */
  keepWhile?: Record<string, FindOperator<unknown>>;
  /**
   * The ids still held by living rows, read in plain SQL with the tables
   * named: they stay whatever their age.
   */
  heldIds?: (ds: DataSource, congregationId: string) => Promise<string[]>;
  /** Plain words for what keepWhile keeps, for the preview. */
  kept?: string;
  /** Switched on: erased every night (R-20), see DatedRule.on. */
  on?: true;
}

/**
 * A rule whose date is not one column and whose period is not a plain count
 * of months (12 November 2026: the S-13 keeps by service years, and a line
 * ends on whichever of two days it ended). It also says what removal will do:
 * clear a name and keep the record, or take the record away.
 */
export interface CountedRule {
  kind: 'counted';
  key: string;
  what: string;
  basis: string;
  entity: EntityTarget<ObjectLiteral>;
  does: 'anonymise' | 'delete';
  /** The first day still kept, seen from the congregation's today. */
  keptFrom: (today: string) => string;
  count: (
    ds: DataSource,
    congregationId: string,
    before: string,
  ) => Promise<number>;
  /**
   * Switched on: what it counts is done every night
   * (RetentionService.applyCounted). Absent: it only counts.
   */
  apply?: (
    ds: DataSource,
    congregationId: string,
    before: string,
  ) => Promise<number>;
}

export type RetentionRule = DatedRule | SoftDeletedRule | CountedRule;

/** Announcements of weeks before `before` — the removal, not yet switched on. */
export async function deleteAnnouncementsBefore(
  ds: DataSource,
  congregationId: string,
  before: string,
): Promise<number> {
  const res = (await ds.query(
    `DELETE FROM meeting_announcements WHERE congregation_id = $1 AND week_start_date < $2::date`,
    [congregationId, before],
  )) as [unknown, number];
  // The «not needed» marks of suggestions leave with their weeks (R-09).
  await ds.query(
    `DELETE FROM announcement_dismissals WHERE congregation_id = $1 AND week_start_date < $2::date`,
    [congregationId, before],
  );
  return res[1] ?? 0;
}

const SCHEDULE =
  '§19: «Расписание встреч и список назначений — хранить не следует»; ' +
  'решение 31.10.2026 — 12 месяцев, ради очерёдности';
const TWELVE_MONTHS: RetentionKeep = { months: 12 };

/** The soft-deleted kinds erased every night (R-20) — keys without «deleted:». */
const ERASED_NOW: ReadonlySet<string> = new Set([
  'assignments',
  'absences',
  'special-events',
  'talk-exchange',
  'visiting-speakers',
]);

/**
 * A deleted row is not always rubbish (review of R-20 step 1, 28 November
 * 2026): `deleted_at` also holds what a living visit took away and will give
 * back. The column of the row itself stays outside every subquery, so no
 * column of the subquery can stand in for it.
 */
const ids = async (
  ds: DataSource,
  sql: string,
  congregationId: string,
): Promise<string[]> =>
  ((await ds.query(sql, [congregationId])) as { id: string }[]).map(
    (r) => r.id,
  );

const STILL_NEEDED: Readonly<
  Record<string, Pick<SoftDeletedRule, 'keepWhile' | 'heldIds' | 'kept'>>
> = {
  // A part hidden by a circuit overseer's visit (co-visit-template hidePart)
  // comes back when the visit is moved or taken away (revert, restore by id).
  assignments: {
    heldIds: (ds, congregationId) =>
      ids(
        ds,
        `SELECT DISTINCT op->>'id' AS id FROM special_events e,
           jsonb_array_elements(CASE WHEN jsonb_typeof(e.co_revert_data) = 'array'
             THEN e.co_revert_data ELSE '[]'::jsonb END) op
         WHERE e.congregation_id = $1 AND op->>'op' = 'deleted'
           AND op->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
        congregationId,
      ),
    kept: 'кроме частей, которые скрыл визит районного: они вернутся при его переносе',
  },
  // An entry set aside by a visit, or the overseer's own, comes back with
  // its note and host when the visit leaves the week or returns
  // (returnEntry, circuitVisitApplied); one removed with its programme line
  // comes back with the line. The visit links are foreign keys: a set one
  // points at an event that still exists, and erasing the event clears it.
  'talk-exchange': {
    keepWhile: { setAsideBy: IsNull(), circuitVisitId: IsNull() },
    heldIds: (ds, congregationId) =>
      ids(
        ds,
        `SELECT DISTINCT talk_exchange_id AS id FROM assignments
         WHERE congregation_id = $1 AND talk_exchange_id IS NOT NULL`,
        congregationId,
      ),
    kept: 'кроме записей, которые отложил визит или на которые ещё указывает строка программы',
  },
  // A card still named by an entry, a part, a card merged into it, or the
  // speaker a visit took off his slot and puts back on revert (op 'speaker':
  // erased, the put-back breaks its foreign key and the visit cannot be
  // taken away). An entry may carry only the card, and merged cards would
  // come back as duplicates.
  'visiting-speakers': {
    heldIds: (ds, congregationId) =>
      ids(
        ds,
        `SELECT visiting_speaker_id AS id FROM talk_exchange
           WHERE congregation_id = $1 AND visiting_speaker_id IS NOT NULL
         UNION SELECT visiting_speaker_id FROM assignments
           WHERE congregation_id = $1 AND visiting_speaker_id IS NOT NULL
         UNION SELECT merged_into_id FROM visiting_speakers
           WHERE congregation_id = $1 AND merged_into_id IS NOT NULL
         UNION SELECT (op->'prev'->>'visitingSpeakerId')::uuid FROM special_events e,
           jsonb_array_elements(CASE WHEN jsonb_typeof(e.co_revert_data) = 'array'
             THEN e.co_revert_data ELSE '[]'::jsonb END) op
         WHERE e.congregation_id = $1 AND op->>'op' = 'speaker'
           AND op->'prev'->>'visitingSpeakerId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
        congregationId,
      ),
    kept: 'кроме карточек, на которые ещё ссылаются записи, части, объединённые карточки или визит районного',
  },
};

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
    cascades: [
      'cart_days',
      'cart_cancellations',
      'cart_assignments',
      'cart_requests',
    ],
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
    cascades: ['co_visit_items', 'co_visit_told', 'memorial_items'],
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
    emptyMeans: 'startDate',
    keep: { months: 1 },
    on: true,
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

  // The S-13 (12 November 2026): names for the current and the previous
  // service year, the lines themselves for five.
  {
    kind: 'counted',
    key: 'territory-names',
    what: 'Имена держателей в записях об участках (S-13)',
    basis:
      'Бланк S-13: записи хранятся за текущий и прошлый служебный год; ' +
      'решение 12.11.2026 — имя заменяется на «—», строка остаётся',
    entity: TerritoryAssignment,
    does: 'anonymise',
    keptFrom: namesKeptFrom,
    count: countNamedLinesBefore,
    // Switched on 17 November 2026 (decision of Lionel; 0 on the live data).
    apply: anonymiseNamesBefore,
  },
  {
    kind: 'counted',
    key: 'territory-lines',
    what: 'Строки истории участков старше пяти служебных лет',
    basis:
      'Решение 12.11.2026 — история участков 5 служебных лет, без имён; ' +
      'последний день, когда участок пройден, переходит на сам участок',
    entity: TerritoryAssignment,
    does: 'delete',
    keptFrom: linesKeptFrom,
    count: countLinesBefore,
    apply: deleteLinesBefore,
  },
  {
    kind: 'counted',
    key: 'territory-requests',
    what: 'Закрытые просьбы об участке старше 30 дней',
    basis:
      'Решение 17.11.2026 — просьба хранится до ответа и ещё 30 дней, ' +
      'без причин и текста',
    entity: TerritoryRequest,
    does: 'delete',
    keptFrom: requestsKeptFrom,
    count: countClosedRequestsBefore,
    apply: deleteClosedRequestsBefore,
  },
  // Announcements (R-03, 24 November 2026): kept whole and encrypted, then
  // gone 30 days after their week — what was said aloud needs no archive.
  {
    kind: 'counted',
    key: 'announcements',
    what: 'Объявления на встречах старше 30 дней',
    basis:
      'Решение 24.11.2026 (R-03) — объявление удаляется через 30 дней ' +
      'после недели встречи',
    entity: MeetingAnnouncement,
    does: 'delete',
    keptFrom: keptFromWeek,
    count: async (ds, congregationId, before) =>
      Number(
        (
          await ds.query(
            `SELECT COUNT(*)::int AS n FROM meeting_announcements WHERE congregation_id = $1 AND week_start_date < $2::date`,
            [congregationId, before],
          )
        )[0]?.n ?? 0,
      ),
    // Counting only, as every new rule begins (retention.service.ts): the
    // removal, deleteAnnouncementsBefore above, is switched on here once the
    // counts have been seen on the live data.
  },

  // «Deleted» rows stay in the table so a deletion can be undone. After
  // thirty days the undo window is over and the row goes for good
  // (decision of 31 October 2026).
  //
  // Erased every night since R-20 (28 November 2026) — those whose counts
  // were seen on the live data. What a living row still leans on stays
  // (STILL_NEEDED); the rest goes with what is its own:
  //  - assignments: nothing points at one; a part hidden by a visit stays;
  //  - absences: nothing points at one;
  //  - special-events: its own visit items, folder, Memorial rows and the
  //    absences made for it go with it (CASCADE); a talk set aside for it
  //    or tied to its visit is freed (SET NULL) and goes the next night;
  //  - talk-exchange: an absence only loses the link; one a programme line
  //    or a visit still holds stays;
  //  - visiting-speakers: only cards nothing names any more; pairs said to
  //    be two people go with them.
  // The others stay counted until rows appear and are looked at: groups and
  // external congregations still referenced by living rows (SET NULL), and
  // cards and sign-ins (R-20 step 3).
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
      ...(STILL_NEEDED[key] ?? {}),
      ...(ERASED_NOW.has(key) ? { on: true as const } : {}),
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
