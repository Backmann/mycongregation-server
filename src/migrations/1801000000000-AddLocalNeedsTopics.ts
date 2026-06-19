import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocalNeedsTopics1801000000000 implements MigrationInterface {
  name = 'AddLocalNeedsTopics1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "local_needs_topics" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "title" text NOT NULL,
        "notes" text,
        "speaker_publisher_id" uuid,
        "used_week" date,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_local_needs_topics" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_local_needs_congregation" ON "local_needs_topics" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_local_needs_speaker" ON "local_needs_topics" ("speaker_publisher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_local_needs_cong_week" ON "local_needs_topics" ("congregation_id", "used_week")`,
    );
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics"
        ADD CONSTRAINT "FK_local_needs_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics"
        ADD CONSTRAINT "FK_local_needs_speaker"
        FOREIGN KEY ("speaker_publisher_id") REFERENCES "publishers"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "local_needs_topics"`);
  }
}
