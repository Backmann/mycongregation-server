import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the unused `is_regular` flag from publishers. The "regular" state is
 * fully derived from report submission (computeStatusFromReports), so the
 * manual column carried no live logic — it was only ever written as a form
 * default and cleared on anonymization. `is_active` is intentionally KEPT: it
 * still drives removal/restore, account login state and anonymization.
 *
 * down() re-adds the column with its original default so the change is
 * reversible; the old per-row values are not restorable (they were meaningless).
 */
export class DropPublisherIsRegular1838000000000 implements MigrationInterface {
  name = 'DropPublisherIsRegular1838000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN IF EXISTS "is_regular"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers"
       ADD COLUMN IF NOT EXISTS "is_regular" boolean NOT NULL DEFAULT true`,
    );
  }
}
