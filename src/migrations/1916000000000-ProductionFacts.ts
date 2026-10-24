import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checks of the live database that tell numbers and nothing else
 * (24 October 2026, Lionel).
 *
 * Until now a check after a deploy was a SQL file Lionel ran by hand under
 * the main database user — a user that may read and change everything, held
 * back only by a `BEGIN READ ONLY … ROLLBACK` someone had to remember to
 * write. And names of publishers are stored in plain text, so a careless
 * «show me the row» would have carried them out.
 *
 * Now:
 *  - the role `mycongregation_facts` may read no table at all. It may call
 *    the functions of the schema `facts`, and nothing else;
 *  - each function answers with a name and a number per check. The type of
 *    the answer is the guarantee: a name cannot come out of a bigint;
 *  - the functions take no arguments, read only, and fix their search_path,
 *    because they run with the rights of their owner (SECURITY DEFINER).
 *
 * The role has no password. The database admits a password-less login only
 * from inside its own container (pg_hba: local trust; from outside
 * scram-sha-256), and only root on the server gets inside the container —
 * so nobody gains a way in that did not exist.
 *
 * A check with `expect_zero` is a rule the code keeps: anything else is
 * a finding, and the deploy says so. The others are figures for reading.
 */
export class ProductionFacts1916000000000 implements MigrationInterface {
  name = 'ProductionFacts1916000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Roles belong to the whole cluster, not to one database: on a second
    // database of the same server (the tests' copies) it is already there.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mycongregation_facts') THEN
          CREATE ROLE mycongregation_facts LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS facts`);
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
    // Nobody may call it by default; the facts role may, and may reach
    // nothing else in the schema.
    await queryRunner.query(
      `REVOKE ALL ON FUNCTION facts.after_deploy() FROM PUBLIC`,
    );
    await queryRunner.query(
      `GRANT USAGE ON SCHEMA facts TO mycongregation_facts`,
    );
    await queryRunner.query(
      `GRANT EXECUTE ON FUNCTION facts.after_deploy() TO mycongregation_facts`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS facts.after_deploy()`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS facts`);
    // The role stays: it belongs to the whole server, and another database
    // on it may still have granted it something.
  }
}
