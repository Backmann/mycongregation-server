import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The lines a cut was first proposed with (16 November 2026, step 3b of the
 * draft: moving the lines by hand). The keeper can go back to them, and the
 * service committee sees that a line was moved by hand. A proposal already
 * in the draft takes its present lines: whether they were moved before is
 * not known.
 *
 * And when a cut's parts last changed by more than a tenth of the homes:
 * a «no remarks» given before that was about other lines.
 */
export class RecutSuggestedLines1931600000000 implements MigrationInterface {
  name = 'RecutSuggestedLines1931600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" ADD COLUMN IF NOT EXISTS "suggested_lines" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" ADD COLUMN IF NOT EXISTS "lines_changed_at" timestamptz`,
    );
    await queryRunner.query(
      `UPDATE "territory_recut_proposals" SET "suggested_lines" = "lines"
        WHERE "kind" = 'cut' AND "suggested_lines" IS NULL AND "lines" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" DROP COLUMN IF EXISTS "lines_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_recut_proposals" DROP COLUMN IF EXISTS "suggested_lines"`,
    );
  }
}
