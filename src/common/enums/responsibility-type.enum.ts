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
}
