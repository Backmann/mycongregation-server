import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The title the workbook last put into a part (24 October 2026).
 *
 * Loading the same workbook again wrote its titles over the ones a person had
 * typed into still-empty parts — a local-needs topic among them (sync audit
 * M3). Remembering what the import itself wrote tells the two apart: a title
 * that is no longer the imported one was changed by hand and is kept. Rows
 * from before have none; for them only a placed local-needs topic is kept.
 */
export class AssignmentImportedTitle1914000000000 implements MigrationInterface {
  name = 'AssignmentImportedTitle1914000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "imported_title" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "imported_title"`,
    );
  }
}
