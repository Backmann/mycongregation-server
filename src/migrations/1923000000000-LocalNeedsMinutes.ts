import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Local needs by the clock (28 October 2026): the body of elders picks a
 * topic to fit the minutes the workbook gives the part. A topic may say how
 * long it is meant to take, and each use keeps how long its part was — for
 * when the part itself is gone.
 */
export class LocalNeedsMinutes1923000000000 implements MigrationInterface {
  name = 'LocalNeedsMinutes1923000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "local_needs_topics" ADD COLUMN IF NOT EXISTS "duration_min" smallint`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "local_needs_topics"
          ADD CONSTRAINT "CHK_local_needs_topics_duration" CHECK ("duration_min" BETWEEN 1 AND 60);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(
      `ALTER TABLE "local_needs_uses" ADD COLUMN IF NOT EXISTS "duration_min" smallint`,
    );
    // The uses already written: their part's minutes, where the part is there.
    await queryRunner.query(`
      UPDATE "local_needs_uses" u
         SET "duration_min" = a."part_duration_min"
        FROM "assignments" a
       WHERE a."id" = u."assignment_id" AND u."duration_min" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "local_needs_uses" DROP COLUMN IF EXISTS "duration_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "local_needs_topics" DROP CONSTRAINT IF EXISTS "CHK_local_needs_topics_duration"`,
    );
    await queryRunner.query(
      `ALTER TABLE "local_needs_topics" DROP COLUMN IF EXISTS "duration_min"`,
    );
  }
}
