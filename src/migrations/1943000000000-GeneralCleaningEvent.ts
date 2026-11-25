import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The general cleaning becomes an event (25 November 2026, special-events
 * R-09): Lionel, «добавить новое событие — генеральная уборка. И с отдела
 * уборки тогда её убрать».
 *
 * Every «general» row of the cleaning turns into an event of the kind
 * `general_cleaning`: the day and hour the cleaning coordinator set, read on
 * the congregation's own clock; with none set, the Saturday of that week and
 * no hour. The name is the kind's, in the congregation's language.
 *
 * The live data held no such row when this was written (checked 25 November
 * 2026: 31 cleanings after the meetings, 18 weekly, 0 general), so this is
 * for any other copy — the stand, a second congregation.
 *
 * The rows moved are kept first in `cleaning_general_1943` with the event
 * made of each, and down puts them back and removes those events.
 */
export class GeneralCleaningEvent1943000000000 implements MigrationInterface {
  name = 'GeneralCleaningEvent1943000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cleaning_general_1943" (
        "id" uuid PRIMARY KEY,
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "thorough_planned_at" timestamptz,
        "created_at" timestamptz,
        "updated_at" timestamptz,
        "event_id" uuid NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "cleaning_general_1943"
        ("id", "congregation_id", "week_start_date", "thorough_planned_at",
         "created_at", "updated_at", "event_id")
      SELECT c."id", c."congregation_id", c."week_start_date",
             c."thorough_planned_at", c."created_at", c."updated_at",
             uuid_generate_v4()
        FROM "cleaning_assignments" c
       WHERE c."slot_type" = 'general'
      ON CONFLICT ("id") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "special_events"
        ("id", "congregation_id", "title", "type", "date", "time")
      SELECT b."event_id", b."congregation_id",
             CASE
               WHEN cg."language" LIKE 'de%' THEN 'Grundreinigung'
               WHEN cg."language" LIKE 'en%' THEN 'General cleaning'
               ELSE 'Генеральная уборка'
             END,
             'general_cleaning',
             COALESCE(
               (b."thorough_planned_at" AT TIME ZONE COALESCE(cg."timezone", 'Europe/Berlin'))::date,
               b."week_start_date" + 5
             ),
             CASE
               WHEN b."thorough_planned_at" IS NULL THEN NULL
               ELSE to_char(b."thorough_planned_at" AT TIME ZONE COALESCE(cg."timezone", 'Europe/Berlin'), 'HH24:MI')
             END
        FROM "cleaning_general_1943" b
        JOIN "congregations" cg ON cg."id" = b."congregation_id"
       WHERE NOT EXISTS (
         SELECT 1 FROM "special_events" e WHERE e."id" = b."event_id"
       )
    `);
    await queryRunner.query(
      `DELETE FROM "cleaning_assignments" WHERE "slot_type" = 'general'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "cleaning_assignments"
        ("id", "congregation_id", "week_start_date", "slot_type",
         "service_group_id", "thorough_planned_at", "created_at", "updated_at")
      SELECT "id", "congregation_id", "week_start_date", 'general', NULL,
             "thorough_planned_at", "created_at", "updated_at"
        FROM "cleaning_general_1943"
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      DELETE FROM "special_events"
       WHERE "id" IN (SELECT "event_id" FROM "cleaning_general_1943")
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "cleaning_general_1943"`);
  }
}
