import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The folder for the circuit overseer, form S-61 (17 November 2026): how
 * each item stands, the S-62 milestone, page 2 and the handing over.
 */
export class CoVisitFolder1932000000000 implements MigrationInterface {
  name = 'CoVisitFolder1932000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "co_visit_folders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "special_event_id" uuid NOT NULL,
        "s62_sent_at" TIMESTAMP WITH TIME ZONE,
        "s62_sent_by_user_id" uuid,
        "s62_checked_at" TIMESTAMP WITH TIME ZONE,
        "s62_checked_by_user_id" uuid,
        "answers" jsonb,
        "answers_erased_at" TIMESTAMP WITH TIME ZONE,
        "handed_over_at" TIMESTAMP WITH TIME ZONE,
        "handed_over_by_user_id" uuid,
        "files_deleted" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_co_visit_folders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_co_visit_folders_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_folders_event" FOREIGN KEY ("special_event_id")
          REFERENCES "special_events"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_co_visit_folders_event"
         ON "co_visit_folders" ("special_event_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "co_visit_folder_marks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "special_event_id" uuid NOT NULL,
        "item_key" character varying(60) NOT NULL,
        "state" character varying(12) NOT NULL,
        "stamp" character varying(40),
        "marked_by_user_id" uuid,
        "marked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_co_visit_folder_marks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_co_visit_folder_marks_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_co_visit_folder_marks_event" FOREIGN KEY ("special_event_id")
          REFERENCES "special_events"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_co_visit_folder_marks_item"
         ON "co_visit_folder_marks" ("special_event_id", "item_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "co_visit_folder_marks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "co_visit_folders"`);
  }
}
