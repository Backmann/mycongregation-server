import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One more rule for the check after every deploy (25 October 2026): a guest
 * still set aside by a circuit visit that has gone. Removing the visit gives
 * back exactly the entries it set aside (1918); the rule catches the next
 * way round that. And a figure for reading: guests set aside ahead.
 * The same function, replaced whole; the grants stay as 1916 gave them.
 */
export class SetAsideFacts1919000000000 implements MigrationInterface {
  name = 'SetAsideFacts1919000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION facts.after_deploy()
      RETURNS TABLE (check_name text, value bigint, expect_zero boolean)
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $fn$
        -- Rules the code keeps: each must be 0.
        SELECT 'school_absences_of_removed_schools', count(*), true
          FROM absences a
          JOIN pioneer_school_duties d ON d.id = a.pioneer_school_duty_id
          JOIN pioneer_school_days y ON y.id = d.day_id
          JOIN pioneer_schools s ON s.id = y.school_id
         WHERE s.deleted_at IS NOT NULL AND a.deleted_at IS NULL
        UNION ALL
        SELECT 'school_duties_ahead_of_removed_helpers', count(*), true
          FROM pioneer_school_duties d
          JOIN pioneer_school_helpers h ON h.id = d.helper_id
          JOIN pioneer_school_days y ON y.id = d.day_id
         WHERE h.deleted_at IS NOT NULL AND y.date >= current_date
        UNION ALL
        SELECT 'fs_drafts_ahead_of_removed_groups', count(*), true
          FROM field_service_meetings m
          JOIN service_groups g ON g.id = m.service_group_id
         WHERE g.deleted_at IS NOT NULL AND m.published_at IS NULL
           AND m.cancelled_at IS NULL
           AND m.week_start_date + (m.day_of_week - 1) >= current_date
        UNION ALL
        SELECT 'talk_weeks_with_two_incoming', count(*), true
          FROM (
            SELECT 1
              FROM talk_exchange
             WHERE direction = 'incoming' AND deleted_at IS NULL
               AND status <> 'did_not_happen'
             GROUP BY congregation_id, date - (extract(isodow from date)::int - 1)
            HAVING count(*) > 1
          ) w
        UNION ALL
        SELECT 'talk_lines_linked_to_missing_entry', count(*), true
          FROM assignments a
          LEFT JOIN talk_exchange t ON t.id = a.talk_exchange_id
         WHERE a.talk_exchange_id IS NOT NULL AND a.deleted_at IS NULL
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
        UNION ALL
        -- A circuit visit that left something behind (24 October 2026):
        -- the overseer in the programme or in «К нам» of a week with no
        -- visit, or two speakers in one line outside a visit week.
        SELECT 'overseer_without_visit', count(*), true
          FROM (
            SELECT a.week_start_date
              FROM assignments a
              JOIN visiting_speakers v ON v.id = a.visiting_speaker_id AND v.circuit_overseer
             WHERE a.part_key = 'public_talk_speaker' AND a.deleted_at IS NULL
               AND a.status <> 'cancelled'
               AND a.week_start_date >= date_trunc('week', current_date)::date
               AND NOT EXISTS (
                 SELECT 1 FROM special_events e
                  WHERE e.congregation_id = a.congregation_id AND e.deleted_at IS NULL
                    AND e.type = 'circuit_overseer_visit'
                    AND date_trunc('week', e.date)::date = a.week_start_date)
            UNION ALL
            SELECT date_trunc('week', t.date)::date
              FROM talk_exchange t
              JOIN visiting_speakers v ON v.id = t.visiting_speaker_id AND v.circuit_overseer
             WHERE t.direction = 'incoming' AND t.deleted_at IS NULL
               AND t.status <> 'did_not_happen' AND t.date >= current_date
               AND NOT EXISTS (
                 SELECT 1 FROM special_events e
                  WHERE e.congregation_id = t.congregation_id AND e.deleted_at IS NULL
                    AND e.type = 'circuit_overseer_visit'
                    AND date_trunc('week', e.date)::date = date_trunc('week', t.date)::date)
          ) w
        UNION ALL
        SELECT 'two_speakers_in_a_line', count(*), true
          FROM assignments a
         WHERE a.part_key = 'public_talk_speaker' AND a.deleted_at IS NULL
           AND a.status <> 'cancelled'
           AND a.week_start_date >= date_trunc('week', current_date)::date
           AND a.publisher_id IS NOT NULL AND coalesce(trim(a.speaker_name), '') <> ''
           AND NOT EXISTS (
             SELECT 1 FROM special_events e
              WHERE e.congregation_id = a.congregation_id AND e.deleted_at IS NULL
                AND e.type = 'circuit_overseer_visit'
                AND date_trunc('week', e.date)::date = a.week_start_date)
        UNION ALL
        -- A guest still set aside by a visit that is gone (25 October 2026):
        -- removing the visit gives back the entries it set aside.
        SELECT 'talk_guests_set_aside_by_gone_visit', count(*), true
          FROM talk_exchange t
          LEFT JOIN special_events e ON e.id = t.set_aside_by
         WHERE t.set_aside_by IS NOT NULL AND t.deleted_at IS NOT NULL
           AND t.date >= date_trunc('week', current_date)::date
           AND (e.id IS NULL OR e.deleted_at IS NOT NULL)
        UNION ALL
        -- The role itself: it must still see no table and create nothing.
        SELECT 'facts_role_tables_readable', count(*), true
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
           AND has_table_privilege('mycongregation_facts', c.oid, 'SELECT')
        UNION ALL
        SELECT 'facts_role_can_create_in_public',
               (has_schema_privilege('mycongregation_facts', 'public', 'CREATE'))::int::bigint,
               true
        UNION ALL
        -- Figures for reading.
        SELECT 'postgres_major', current_setting('server_version_num')::bigint / 10000, false
        UNION ALL
        SELECT 'migrations_applied', count(*), false FROM migrations
        UNION ALL
        SELECT 'congregations', count(*), false FROM congregations
        UNION ALL
        SELECT 'fs_drafts_ahead', count(*), false
          FROM field_service_meetings m
         WHERE m.published_at IS NULL AND m.cancelled_at IS NULL
           AND m.week_start_date + (m.day_of_week - 1) >= current_date
        UNION ALL
        SELECT 'fs_removed_days', count(*), false FROM field_service_removed_days
        UNION ALL
        SELECT 'talk_lines_linked', count(*), false
          FROM assignments WHERE talk_exchange_id IS NOT NULL AND deleted_at IS NULL
        UNION ALL
        SELECT 'talk_guests_set_aside_ahead', count(*), false
          FROM talk_exchange
         WHERE set_aside_by IS NOT NULL AND deleted_at IS NOT NULL
           AND date >= current_date
      $fn$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION facts.after_deploy()
      RETURNS TABLE (check_name text, value bigint, expect_zero boolean)
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $fn$
        -- Rules the code keeps: each must be 0.
        SELECT 'school_absences_of_removed_schools', count(*), true
          FROM absences a
          JOIN pioneer_school_duties d ON d.id = a.pioneer_school_duty_id
          JOIN pioneer_school_days y ON y.id = d.day_id
          JOIN pioneer_schools s ON s.id = y.school_id
         WHERE s.deleted_at IS NOT NULL AND a.deleted_at IS NULL
        UNION ALL
        SELECT 'school_duties_ahead_of_removed_helpers', count(*), true
          FROM pioneer_school_duties d
          JOIN pioneer_school_helpers h ON h.id = d.helper_id
          JOIN pioneer_school_days y ON y.id = d.day_id
         WHERE h.deleted_at IS NOT NULL AND y.date >= current_date
        UNION ALL
        SELECT 'fs_drafts_ahead_of_removed_groups', count(*), true
          FROM field_service_meetings m
          JOIN service_groups g ON g.id = m.service_group_id
         WHERE g.deleted_at IS NOT NULL AND m.published_at IS NULL
           AND m.cancelled_at IS NULL
           AND m.week_start_date + (m.day_of_week - 1) >= current_date
        UNION ALL
        SELECT 'talk_weeks_with_two_incoming', count(*), true
          FROM (
            SELECT 1
              FROM talk_exchange
             WHERE direction = 'incoming' AND deleted_at IS NULL
               AND status <> 'did_not_happen'
             GROUP BY congregation_id, date - (extract(isodow from date)::int - 1)
            HAVING count(*) > 1
          ) w
        UNION ALL
        SELECT 'talk_lines_linked_to_missing_entry', count(*), true
          FROM assignments a
          LEFT JOIN talk_exchange t ON t.id = a.talk_exchange_id
         WHERE a.talk_exchange_id IS NOT NULL AND a.deleted_at IS NULL
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
        UNION ALL
        -- A circuit visit that left something behind (24 October 2026):
        -- the overseer in the programme or in «К нам» of a week with no
        -- visit, or two speakers in one line outside a visit week.
        SELECT 'overseer_without_visit', count(*), true
          FROM (
            SELECT a.week_start_date
              FROM assignments a
              JOIN visiting_speakers v ON v.id = a.visiting_speaker_id AND v.circuit_overseer
             WHERE a.part_key = 'public_talk_speaker' AND a.deleted_at IS NULL
               AND a.status <> 'cancelled'
               AND a.week_start_date >= date_trunc('week', current_date)::date
               AND NOT EXISTS (
                 SELECT 1 FROM special_events e
                  WHERE e.congregation_id = a.congregation_id AND e.deleted_at IS NULL
                    AND e.type = 'circuit_overseer_visit'
                    AND date_trunc('week', e.date)::date = a.week_start_date)
            UNION ALL
            SELECT date_trunc('week', t.date)::date
              FROM talk_exchange t
              JOIN visiting_speakers v ON v.id = t.visiting_speaker_id AND v.circuit_overseer
             WHERE t.direction = 'incoming' AND t.deleted_at IS NULL
               AND t.status <> 'did_not_happen' AND t.date >= current_date
               AND NOT EXISTS (
                 SELECT 1 FROM special_events e
                  WHERE e.congregation_id = t.congregation_id AND e.deleted_at IS NULL
                    AND e.type = 'circuit_overseer_visit'
                    AND date_trunc('week', e.date)::date = date_trunc('week', t.date)::date)
          ) w
        UNION ALL
        SELECT 'two_speakers_in_a_line', count(*), true
          FROM assignments a
         WHERE a.part_key = 'public_talk_speaker' AND a.deleted_at IS NULL
           AND a.status <> 'cancelled'
           AND a.week_start_date >= date_trunc('week', current_date)::date
           AND a.publisher_id IS NOT NULL AND coalesce(trim(a.speaker_name), '') <> ''
           AND NOT EXISTS (
             SELECT 1 FROM special_events e
              WHERE e.congregation_id = a.congregation_id AND e.deleted_at IS NULL
                AND e.type = 'circuit_overseer_visit'
                AND date_trunc('week', e.date)::date = a.week_start_date)
        UNION ALL
        -- The role itself: it must still see no table and create nothing.
        SELECT 'facts_role_tables_readable', count(*), true
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
           AND has_table_privilege('mycongregation_facts', c.oid, 'SELECT')
        UNION ALL
        SELECT 'facts_role_can_create_in_public',
               (has_schema_privilege('mycongregation_facts', 'public', 'CREATE'))::int::bigint,
               true
        UNION ALL
        -- Figures for reading.
        SELECT 'postgres_major', current_setting('server_version_num')::bigint / 10000, false
        UNION ALL
        SELECT 'migrations_applied', count(*), false FROM migrations
        UNION ALL
        SELECT 'congregations', count(*), false FROM congregations
        UNION ALL
        SELECT 'fs_drafts_ahead', count(*), false
          FROM field_service_meetings m
         WHERE m.published_at IS NULL AND m.cancelled_at IS NULL
           AND m.week_start_date + (m.day_of_week - 1) >= current_date
        UNION ALL
        SELECT 'fs_removed_days', count(*), false FROM field_service_removed_days
        UNION ALL
        SELECT 'talk_lines_linked', count(*), false
          FROM assignments WHERE talk_exchange_id IS NOT NULL AND deleted_at IS NULL
      $fn$
    `);
  }
}
