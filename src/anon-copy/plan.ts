/**
 * The inventory of the anonymised copy: what happens to every field of the
 * database when a copy is made for testing.
 *
 * It is an allow-list. A field that is not written here is not copied — and
 * the copy is refused until it is: see plan.spec.ts (every field the code
 * knows) and the same check against the real database in cli.ts. So a field
 * added half a year from now cannot slip into a copy by being forgotten;
 * somebody has to decide about it here first.
 *
 * The decisions were agreed with the owner on 6 October 2026:
 *  - a name is replaced by an invented one, the same everywhere;
 *  - text a person typed is replaced by a numbered stand-in or removed;
 *  - contacts are removed (they are stored encrypted and are never even
 *    decrypted here: the copy is made without the key);
 *  - text from the publications and from the code, dates, numbers and the
 *    links between records are copied;
 *  - «deaf», «blind» and «in prison» are set to «no» for everybody.
 */

export type Rule =
  /** As it is. */
  | 'copy'
  /** Removed: nothing in its place. */
  | 'null'
  /** «No», whatever it was. */
  | 'false'
  /** A first name; the row's own `gender` decides which list it comes from. */
  | 'first'
  /** A wife's first name. */
  | 'wife'
  | 'last'
  /** A whole name in one field, replaced word by word. */
  | 'full'
  /** Text that may have a surname inside: only the surname is replaced. */
  | 'scrub'
  /** Kept only when it points at jw.org. */
  | 'url'
  /** Kept only when it is a clock time and nothing else. */
  | 'time'
  | 'email'
  | 'login'
  /** An event's title, said again from its type. */
  | 'eventTitle'
  /** The circuit visit's undo plan: names inside by the rules above. */
  | 'revert'
  /** A speaker merge record: known keys only. */
  | 'merge'
  /** A numbered stand-in; the same real value gets the same number. */
  | `label:${string}`;

export type TablePlan = 'skip' | Record<string, Rule>;

function as(rule: Rule, columns: string): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  for (const c of columns.split(/\s+/).filter(Boolean)) out[c] = rule;
  return out;
}

function table(...parts: Record<string, Rule>[]): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  for (const part of parts) {
    for (const [column, rule] of Object.entries(part)) {
      if (column in out) throw new Error(`anon-copy plan: ${column} twice`);
      out[column] = rule;
    }
  }
  return out;
}

const copy = (columns: string) => as('copy', columns);
const remove = (columns: string) => as('null', columns);

/** Catalogues shared by everybody: no person's text in them. */
export const CATALOGUES = new Set(['songs', 'public_talks']);

export const PLAN: Record<string, TablePlan> = {
  // ── not copied at all ────────────────────────────────────────────────
  /** Former values of everything, names included. */
  audit_logs: 'skip',
  /** Secrets. */
  refresh_sessions: 'skip',
  /** Addresses of real devices. */
  push_tokens: 'skip',
  push_receipts: 'skip',
  web_push_subscriptions: 'skip',
  /** Texts of notifications, with names. */
  notification_outbox: 'skip',
  /** «Told about the assignment» marks — of no use to a test. */
  assignment_notices: 'skip',
  /** The copy carries the name of the last migration instead. */
  migrations: 'skip',

  // ── people ───────────────────────────────────────────────────────────
  publishers: table(
    copy(`id congregation_id user_id service_group_id gender birth_date
      is_active appointment baptism_date ministry_start_date pioneer_type
      pioneer_since removal_reason removed_at restored_at created_at
      updated_at deleted_at capabilities status status_manually_overridden
      status_overridden_by_id status_overridden_at last_edited_by_id
      public_talk_numbers anonymized_at spiritual_status
      contacts_confirmed_at contacts_confirmed_by_user_id`),
    { first_name: 'first', last_name: 'last', display_name: 'full' },
    remove('middle_name mobile_phone email address notes removed_note'),
    as('false', 'is_deaf is_blind is_imprisoned'),
  ),
  users: table(
    copy(`id congregation_id role is_active last_login_at created_at
      updated_at deleted_at ui_language can_view_private_data last_seen_at
      is_owner hide_presence client_platform client_kind client_os
      client_app_version client_seen_at invite_code_attempts push_state
      push_state_at reminder_ladder`),
    { email: 'email', login_name: 'login' },
    remove(`password_hash reset_token_hash reset_token_expires_at
      invite_code_hash invite_code_expires_at`),
  ),
  visiting_speakers: table(
    copy(`id congregation_id external_congregation_id talk_numbers created_at
      updated_at deleted_at auto_created merged_into_id circuit_overseer`),
    { first_name: 'first', last_name: 'last', merge_record: 'merge' },
    remove('phone note'),
  ),
  visiting_speaker_distinct_pairs: copy(
    'id congregation_id speaker_a_id speaker_b_id created_by_user_id created_at',
  ),
  circuit_overseers: table(
    copy('id congregation_id created_at updated_at role is_primary'),
    { first_name: 'first', last_name: 'last', wife_name: 'wife' },
  ),
  pioneer_school_helpers: table(
    copy('id congregation_id publisher_id created_at updated_at deleted_at'),
    {
      first_name: 'first',
      last_name: 'last',
      congregation_name: 'label:Собрание',
    },
  ),
  external_congregations: table(
    copy(`id congregation_id created_at updated_at deleted_at meeting_dow
      meeting_time`),
    { name: 'label:Собрание', city: 'label:Город' },
    remove('contact_name contact_phone note address map_url'),
  ),
  congregations: table(
    copy(`id country language timezone created_at updated_at deleted_at
      assignment_automation_enabled`),
    { name: 'label:Копия собрания' },
  ),
  responsibilities: copy(
    'id congregation_id type user_id assigned_by assigned_at',
  ),
  notification_preferences: copy(
    'id user_id category enabled created_at updated_at',
  ),

  // ── the programme and the rosters ────────────────────────────────────
  assignments: table(
    copy(`id congregation_id week_start_date event_type part_key part_order
      part_duration_min publisher_id assistant_publisher_id status created_at
      updated_at deleted_at public_talk_id changed_since_publish
      visiting_speaker_id special_talk`),
    {
      part_title: 'scrub',
      speaker_name: 'full',
      speaker_congregation: 'label:Собрание',
    },
    remove('notes'),
  ),
  duties: table(
    copy(`id congregation_id week_start_date event_type duty_type slot_index
      publisher_id created_at updated_at sort_order`),
    { custom_label: 'label:Обязанность' },
    remove('notes'),
  ),
  cleaning_assignments: copy(`id congregation_id week_start_date slot_type
    service_group_id created_at updated_at windows thorough_planned_at`),
  cart_locations: table(
    copy('id congregation_id kind is_active created_at updated_at'),
    { name: 'label:Точка' },
    remove('address'),
  ),
  cart_weeks: copy(`id congregation_id week_start_date status start_time
    end_time step_minutes created_by_id created_at updated_at`),
  cart_slots: copy(`id congregation_id week_id date start_time end_time
    location_id created_at`),
  cart_assignments: table(
    copy('id congregation_id slot_id publisher_id created_by_id created_at'),
    { external_name: 'label:Гость' },
  ),
  cart_requests: table(
    copy('id congregation_id slot_id publisher_id created_at'),
    remove('with_whom_note'),
  ),
  field_service_meetings: table(
    copy(`id congregation_id week_start_date day_of_week start_time
      conductor_publisher_id created_at updated_at is_general
      service_group_id service_overseer_visit service_overseer_publisher_id
      service_overseer_assistant_id`),
    { address: 'label:Адрес', source_url: 'url' },
    remove('topic'),
  ),
  field_service_template_slots: table(
    copy(`id congregation_id position ordinal day_of_week start_time
      created_at updated_at`),
    { address: 'label:Адрес' },
  ),
  field_service_month_themes: table(
    copy('id congregation_id year month created_at updated_at'),
    { theme: 'label:Тема месяца' },
  ),
  meeting_settings: table(
    copy(`id congregation_id effective_from midweek_dow midweek_time
      weekend_dow weekend_time microphone_slots created_at updated_at`),
    { address: 'label:Адрес' },
  ),
  halls: table(copy('id congregation_id is_default created_at updated_at'), {
    name: 'label:Зал',
    address: 'label:Адрес',
  }),
  special_events: table(
    copy(`id congregation_id type date replaces_meeting created_at updated_at
      deleted_at end_date co_midweek_dow co_role
      co_accommodation_publisher_id time_end memorial_published_at
      meeting_mode meeting_time`),
    {
      title: 'eventTitle',
      time: 'time',
      program_url: 'url',
      memorial_theme_url: 'url',
      memorial_theme: 'scrub',
      co_first_name: 'first',
      co_last_name: 'last',
      co_wife_name: 'wife',
      co_revert_data: 'revert',
      meeting_address: 'label:Адрес',
    },
    remove('address map_url note co_accommodation_address meeting_note'),
  ),
  co_visit_items: table(
    copy(`id congregation_id special_event_id kind for_wife item_date
      start_time place_kind cart_location_id assignee_publisher_id sort_order
      created_at with_wife deleted_at`),
    { place_text: 'label:Место', assignee_text: 'label:Участник' },
    remove('note'),
  ),
  memorial_items: table(
    copy(`id congregation_id special_event_id section part_key sort_order
      publisher_id song_number created_at updated_at deleted_at`),
    { label: 'scrub', person_text: 'label:Участник' },
    remove('note'),
  ),
  talk_exchange: table(
    copy(`id congregation_id direction date status public_talk_id
      visiting_speaker_id hospitality_publisher_id publisher_id
      host_congregation_id linked_absence_id created_at updated_at
      deleted_at`),
    {
      speaker_name: 'full',
      speaker_congregation: 'label:Собрание',
      special_theme: 'scrub',
    },
    remove('note'),
  ),
  pioneer_schools: table(
    copy(`id congregation_id start_date end_date start_time end_time
      microphone_slots created_at updated_at deleted_at`),
    {
      title: 'label:Школа',
      hall_name: 'label:Зал',
      hall_address: 'label:Адрес',
    },
    remove('notes'),
  ),
  pioneer_school_days: copy(
    'id congregation_id school_id date start_time end_time',
  ),
  pioneer_school_duties: table(
    copy('id congregation_id day_id duty_type slot_index helper_id'),
    { custom_label: 'label:Обязанность' },
  ),

  // ── the body of elders: every text replaced whole ────────────────────
  elder_tasks: table(
    copy(`id congregation_id area assignee_publisher_id due_date status
      done_at done_by_id elders_meeting_id created_by_id created_at
      updated_at assignee_kind due_time kind kind_period`),
    { title: 'label:Задача' },
    remove('details'),
  ),
  elder_task_assignees: copy('task_id publisher_id'),
  elder_task_calendar_log: copy('congregation_id kind period created_at'),
  elders_meetings: table(
    copy(`id congregation_id date start_time created_by_id created_at
      updated_at hall_id minute_taker_publisher_id approved_at
      approved_by_id opening_prayer_publisher_id
      closing_prayer_publisher_id`),
    remove('note place_text'),
  ),
  elders_meeting_items: table(
    copy(`id congregation_id meeting_id position presenter_publisher_id
      minutes outcome task_id created_by_id created_at updated_at area`),
    { title: 'label:Пункт', source_url: 'url' },
    remove('source_text outcome_note'),
  ),
  local_needs_topics: table(
    copy(`id congregation_id speaker_publisher_id used_week created_by_id
      created_at updated_at deleted_at used_assignment_id`),
    { title: 'label:Тема' },
    remove('notes'),
  ),

  // ── the ministry and the reports ─────────────────────────────────────
  service_groups: table(
    copy(`id congregation_id overseer_publisher_id assistant_publisher_id
      created_at updated_at deleted_at`),
    { name: 'label:Группа' },
    remove('meeting_location notes'),
  ),
  service_reports: table(
    copy(`id congregation_id publisher_id report_month served_this_month
      hours_reported bible_studies submitted_at submitted_by_id
      submitted_on_behalf_of created_at updated_at deleted_at last_edited_at
      last_edited_by_id`),
    remove('notes'),
  ),
  pioneer_spells: table(
    copy(`id congregation_id publisher_id pioneer_type start_month end_month
      created_by created_at updated_at`),
    remove('note'),
  ),
  auxiliary_pioneers: table(
    copy(`id congregation_id publisher_id start_month end_month
      until_cancelled created_by created_at updated_at`),
    remove('note'),
  ),
  absences: table(
    copy(`id congregation_id publisher_id start_date end_date created_by_id
      created_at updated_at deleted_at pioneer_school_duty_id
      talk_exchange_id`),
    remove('note'),
  ),
  meeting_attendance: table(
    copy(`id congregation_id date event_type count not_held recorded_by
      created_at updated_at`),
    remove('note'),
  ),
  report_month_closures: copy(
    'id congregation_id report_month closed_by_id closed_at',
  ),
  /** Figures and card ids only — the entity keeps names out on purpose. */
  report_snapshots: copy(`id congregation_id kind period confirmed sent_on
    figures members appointments saved_by_id created_at updated_at`),
  reminder_log: copy('id congregation_id kind key sent_at'),

  // ── catalogues ───────────────────────────────────────────────────────
  songs: copy('id number title is_active created_at updated_at'),
  public_talks: table(
    copy(`id number title is_active created_at updated_at retired_from
      retired_until`),
    remove('retired_reason'),
  ),
};

/** An event's title as its type says it; anything else is «Событие». */
export const EVENT_TITLES: Record<string, string> = {
  circuit_overseer_visit: 'Визит районного старейшины',
  branch_representative_visit: 'Визит представителя филиала',
  circuit_assembly: 'Районный конгресс',
  regional_convention: 'Региональный конгресс',
  memorial: 'Вечеря воспоминания',
  special_talk: 'Специальная речь',
  special_event: 'Особое событие',
  party: 'Встреча собрания',
};

export interface SchemaColumn {
  table: string;
  column: string;
  nullable: boolean;
}

/**
 * Where the plan and a database disagree — in words, one per line. Empty
 * means every field has a decision and every decision has a field.
 */
export function planProblems(
  schema: SchemaColumn[],
  plan: Record<string, TablePlan> = PLAN,
): string[] {
  const problems: string[] = [];
  const inDb = new Map<string, Map<string, boolean>>();
  for (const c of schema) {
    let t = inDb.get(c.table);
    if (!t) inDb.set(c.table, (t = new Map<string, boolean>()));
    t.set(c.column, c.nullable);
  }
  for (const [table, columns] of inDb) {
    const tablePlan = plan[table];
    if (tablePlan === undefined) {
      problems.push(`table ${table}: no decision in the plan`);
      continue;
    }
    if (tablePlan === 'skip') continue;
    for (const [column, nullable] of columns) {
      const rule = tablePlan[column];
      if (rule === undefined) {
        problems.push(`${table}.${column}: no decision in the plan`);
      } else if (rule === 'null' && !nullable) {
        problems.push(`${table}.${column}: cannot be emptied, it is required`);
      }
    }
    for (const column of Object.keys(tablePlan)) {
      if (!columns.has(column)) {
        problems.push(`${table}.${column}: in the plan, not in the database`);
      }
    }
  }
  for (const table of Object.keys(plan)) {
    if (!inDb.has(table)) {
      problems.push(`table ${table}: in the plan, not in the database`);
    }
  }
  return problems.sort();
}
