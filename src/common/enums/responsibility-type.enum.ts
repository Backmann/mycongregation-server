/**
 * Layer 2 responsibility types (see docs/architecture/roles-and-permissions.md).
 *
 * Stored as a varchar column (not a Postgres enum) so new responsibilities can
 * be added by extending this enum WITHOUT a schema migration, per the design
 * principle "sub-roles via flexible structures ... grows without schema
 * migrations".
 *
 * A congregation may have several holders per type and a person may hold
 * several types (UNIQUE(congregationId, type, userId) on the entity).
 */
export enum ResponsibilityType {
  /** Координатор совета старейшин — also weekend meeting in this congregation. */
  BODY_COORDINATOR = 'body_coordinator',
  /** Руководитель встречи «Жизнь и служение» — midweek meeting program. */
  LIFE_MINISTRY_OVERSEER = 'life_ministry_overseer',
  /** Ответственный за публичные речи — invites speakers, manages exchanges. */
  PUBLIC_TALK_COORDINATOR = 'public_talk_coordinator',
  /** Секретарь — S-21 records, transfers. */
  SECRETARY = 'secretary',
  /** Координатор полевого служения — field ministry organization. */
  SERVICE_OVERSEER = 'service_overseer',
  /** Помощник служебного старейшины — same field-ministry permissions. */
  SERVICE_OVERSEER_ASSISTANT = 'service_overseer_assistant',
  /** Публичное свидетельствование — carts, displays. */
  PUBLIC_WITNESSING = 'public_witnessing',
  /** Координатор уборки — Kingdom Hall cleaning rotation. */
  CLEANING_COORDINATOR = 'cleaning_coordinator',
  /** Координатор обязанностей на встречах — meeting duties (security, mics, A/V, …). */
  DUTIES_COORDINATOR = 'duties_coordinator',
  /** Учёт посещаемости встреч — records the S-3 attendance figures. */
  ATTENDANCE_RECORDER = 'attendance_recorder',

  /**
   * Keeps the congregation's accounts.
   *
   * Recorded so the app knows who must NOT audit them: the one who keeps the
   * books and the one who writes the letters are both barred from checking the
   * books, and that is the whole reason this exists. It grants nothing.
   */
  ACCOUNTS_SERVANT = 'accounts_servant',

  /** Stands in for the coordinator, including in putting a brother on the audit. */
  BODY_COORDINATOR_ASSISTANT = 'body_coordinator_assistant',

  /**
   * Руководитель изучения «Сторожевой башни» — he conducts it every weekend.
   *
   * These three were declared in the APP months ago and never here, so the app
   * offered them and the server would have refused them: the mirror image of
   * the two that were added here and forgotten there. The compiler found it
   * the moment a screen was asked to account for every type.
   */
  WT_STUDY_CONDUCTOR = 'wt_study_conductor',

  /**
   * Помощник руководителя изучения — and there may be SEVERAL of them.
   *
   * The one responsibility here held by more than one brother at a time: he
   * stands in when the conductor is away, and a congregation keeps a couple of
   * men able to do it. Every other type has exactly one holder — see
   * SINGLE_HOLDER in the service.
   */
  WT_STUDY_CONDUCTOR_BACKUP = 'wt_study_conductor_backup',

  /** Брат, дающий советы — counsels the student assignments. No assistant. */
  ADVISER = 'adviser',
}
