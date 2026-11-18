import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The visit schedule is published once, then speaks for itself
 * (18 November 2026, Lionel's choice «C»).
 *
 * - `co_published_at`: null while the planner is still filling the week;
 *   nobody sees a draft — not on Home, not in the calendar, not in a push.
 * - `co_noticed_at`: when the people of the visit were last told what is
 *   theirs; an edit after it is said ten minutes after the last one.
 * - `co_visit_items.updated_at`: when an item was last edited.
 * - `co_visit_told`: per person, the lines he was told — what a later word
 *   compares with to say «изменено» or «вы больше не назначены».
 *
 * A visit that already has items is published by this migration, so that
 * nothing anybody sees today disappears from his Home. Nobody is told
 * anything by it: its people are written down as already told.
 */
export class CoVisitPublish1933000000000 implements MigrationInterface {
  name = 'CoVisitPublish1933000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "special_events"
        ADD COLUMN IF NOT EXISTS "co_published_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "co_noticed_at" TIMESTAMP WITH TIME ZONE
    `);
    // An edit has a moment: what «ten minutes after the last edit» counts from.
    await queryRunner.query(`
      ALTER TABLE "co_visit_items"
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "co_visit_told" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "special_event_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "told_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_co_visit_told" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_co_visit_told_person" UNIQUE ("special_event_id", "publisher_id"),
        CONSTRAINT "FK_co_visit_told_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_told_event" FOREIGN KEY ("special_event_id")
          REFERENCES "special_events"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_told_publisher" FOREIGN KEY ("publisher_id")
          REFERENCES "publishers"("id") ON DELETE CASCADE
      )
    `);
    // Visits with items stay visible: published now, their people told.
    await queryRunner.query(`
      UPDATE "special_events" e
         SET "co_published_at" = now(), "co_noticed_at" = now()
       WHERE e."type" = 'circuit_overseer_visit'
         AND e."co_published_at" IS NULL
         AND EXISTS (SELECT 1 FROM "co_visit_items" i
                      WHERE i."special_event_id" = e."id" AND i."deleted_at" IS NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "co_visit_told"`);
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" DROP COLUMN IF EXISTS "updated_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "special_events"
        DROP COLUMN IF EXISTS "co_noticed_at",
        DROP COLUMN IF EXISTS "co_published_at"
    `);
  }
}
