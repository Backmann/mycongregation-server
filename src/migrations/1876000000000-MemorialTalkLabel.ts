import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Речь» becomes «Докладчик» on the Memorial sheet.
 *
 * The line names the PERSON, not the part — beside «Председатель» it reads as
 * one of a pair, and «Речь» read as a thing rather than as somebody.
 *
 * The template is changed for every Memorial drawn up from now on, but a sheet
 * already prepared keeps whatever label it was given: the label is free text
 * a congregation may have edited, so it is not rewritten wholesale. Only rows
 * still carrying the exact word the template put there are touched, and only
 * on the talk line.
 */
export class MemorialTalkLabel1876000000000 implements MigrationInterface {
  name = 'MemorialTalkLabel1876000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "memorial_items"
         SET "label" = 'Докладчик'
       WHERE "part_key" = 'talk'
         AND "section" = 'programme'
         AND "label" = 'Речь'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "memorial_items"
         SET "label" = 'Речь'
       WHERE "part_key" = 'talk'
         AND "section" = 'programme'
         AND "label" = 'Докладчик'
    `);
  }
}
