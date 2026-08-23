import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The date from which a talk is no longer to be given.
 *
 * The catalogue knew only «active» or «not», and the instruction that arrives
 * is more precise than that: a list of numbers AND a date — «не следует
 * преподносить, начиная с 1 сентября 2026 года». Without the date the app
 * could not tell a talk that is finished from one that is finished SOON, and
 * a talk retired in August would have looked wrong on the last Sunday of it.
 *
 * Nullable on purpose: talks retired by hand before this existed have no date
 * and should not be given a made-up one. A null reads as «снята», a date as
 * «снята с такого-то числа», and both are honest.
 */
export class TalkRetiredFrom1873000000000 implements MigrationInterface {
  name = 'TalkRetiredFrom1873000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_talks" ADD COLUMN IF NOT EXISTS "retired_from" date`,
    );
    // Read on every catalogue listing and on every talk picker, where the
    // question is «is this one still to be given», not «which id is it».
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_public_talks_retired_from"
         ON "public_talks" ("retired_from")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_public_talks_retired_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_talks" DROP COLUMN IF EXISTS "retired_from"`,
    );
  }
}
