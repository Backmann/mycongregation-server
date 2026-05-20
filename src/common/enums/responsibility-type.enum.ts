/**
 * Layer 2 responsibility types (see docs/architecture/roles-and-permissions.md).
 *
 * Stored as a varchar column (not a Postgres enum) so new responsibilities can
 * be added by extending this enum WITHOUT a schema migration, per the design
 * principle "sub-roles via flexible structures ... grows without schema
 * migrations".
 *
 * Each congregation may have at most one holder per type
 * (UNIQUE(congregationId, type) on the entity).
 */
export enum ResponsibilityType {
  /** Координатор совета старейшин — also weekend meeting in this congregation. */
  BODY_COORDINATOR = 'body_coordinator',
  /** Руководитель встречи «Жизнь и служение» — midweek meeting program. */
  LIFE_MINISTRY_OVERSEER = 'life_ministry_overseer',
  /** Руководитель изучения «Сторожевой башни» — weekend Watchtower Study. */
  WT_STUDY_CONDUCTOR = 'wt_study_conductor',
  /** Заместитель руководителя изучения СБ — backup for absences. */
  WT_STUDY_CONDUCTOR_BACKUP = 'wt_study_conductor_backup',
  /** Ответственный за публичные речи — invites speakers, manages exchanges. */
  PUBLIC_TALK_COORDINATOR = 'public_talk_coordinator',
  /** Брат, дающий советы — private feedback. May rotate yearly. */
  ADVISER = 'adviser',
  /** Секретарь — S-21 records, transfers. */
  SECRETARY = 'secretary',
  /** Координатор полевого служения — field ministry organization. */
  SERVICE_OVERSEER = 'service_overseer',
  /** Счетовод — congregation finances. */
  ACCOUNTS_SERVANT = 'accounts_servant',
  /** Публичное свидетельствование — carts, displays. */
  PUBLIC_WITNESSING = 'public_witnessing',
  /** Координатор уборки — Kingdom Hall cleaning rotation. */
  CLEANING_COORDINATOR = 'cleaning_coordinator',
}
