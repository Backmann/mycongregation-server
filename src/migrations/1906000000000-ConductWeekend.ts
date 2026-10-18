import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conduct mode for the WEEKEND meeting too (18 October 2026).
 *
 * 1. A room on the meeting as it runs and on its result — the foundation for
 *    a second classroom (entities/conduct-room.ts). Every row so far is the
 *    main hall, and the one-row-per-meeting rule now counts the room.
 * 2. The place «Ведущий времени» on the WEEKEND sheets already made, as
 *    migration 1903 did for the midweek ones: the app generates a sheet only
 *    while it is empty. Current and future weeks only; last on the sheet,
 *    empty. A congregation that does not use it leaves it empty — the place
 *    is optional and counted nowhere.
 */
export class ConductWeekend1906000000000 implements MigrationInterface {
  name = 'ConductWeekend1906000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, uq] of [
      ['conduct_live', 'UQ_conduct_live_week'],
      ['conduct_runs', 'UQ_conduct_runs_week'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "room" varchar(16) NOT NULL DEFAULT 'main'`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${uq}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${uq}" UNIQUE ("congregation_id", "week_start_date", "event_type", "room")`,
      );
    }
    await queryRunner.query(`
      INSERT INTO "duties" ("congregation_id", "week_start_date", "event_type",
        "duty_type", "slot_index", "sort_order")
      SELECT "congregation_id", "week_start_date", 'weekend', 'timekeeper', 0,
        MAX("sort_order") + 1
      FROM "duties"
      WHERE "event_type" = 'weekend'
        AND "week_start_date" >= CURRENT_DATE - 6
      GROUP BY "congregation_id", "week_start_date"
      ON CONFLICT ON CONSTRAINT "uq_duty_slot" DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "duties" WHERE "duty_type" = 'timekeeper' AND "event_type" = 'weekend' AND "publisher_id" IS NULL`,
    );
    for (const [table, uq] of [
      ['conduct_live', 'UQ_conduct_live_week'],
      ['conduct_runs', 'UQ_conduct_runs_week'],
    ]) {
      await queryRunner.query(`DELETE FROM "${table}" WHERE "room" <> 'main'`);
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${uq}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${uq}" UNIQUE ("congregation_id", "week_start_date", "event_type")`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "room"`,
      );
    }
  }
}
