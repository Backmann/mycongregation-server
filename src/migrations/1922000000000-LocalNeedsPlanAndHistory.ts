import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Local needs (28 October 2026): a topic may be planned for a week whose
 * programme is not imported yet, and every time a topic is given is kept for
 * two years. The history starts from what the topics already know — their
 * last week, and the part they were placed on.
 */
export class LocalNeedsPlanAndHistory1922000000000 implements MigrationInterface {
  name = 'LocalNeedsPlanAndHistory1922000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "local_needs_topics" ADD COLUMN IF NOT EXISTS "planned_week" date`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "local_needs_uses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "topic_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "assignment_id" uuid,
        "speaker_publisher_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_local_needs_uses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_local_needs_uses_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_local_needs_uses_topic" FOREIGN KEY ("topic_id")
          REFERENCES "local_needs_topics"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_local_needs_uses_speaker" FOREIGN KEY ("speaker_publisher_id")
          REFERENCES "publishers"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_local_needs_uses_congregation" ON "local_needs_uses" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_local_needs_uses_topic_week" ON "local_needs_uses" ("topic_id", "week_start_date")`,
    );
    await queryRunner.query(`
      INSERT INTO "local_needs_uses"
        ("congregation_id", "topic_id", "week_start_date", "assignment_id", "speaker_publisher_id")
      SELECT t."congregation_id", t."id", t."used_week", t."used_assignment_id",
             coalesce(a."publisher_id", t."speaker_publisher_id")
        FROM "local_needs_topics" t
        LEFT JOIN "assignments" a ON a."id" = t."used_assignment_id" AND a."deleted_at" IS NULL
       WHERE t."used_week" IS NOT NULL
         AND t."used_week" >= (current_date - interval '2 years')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "local_needs_uses"`);
    await queryRunner.query(
      `ALTER TABLE "local_needs_topics" DROP COLUMN IF EXISTS "planned_week"`,
    );
  }
}
