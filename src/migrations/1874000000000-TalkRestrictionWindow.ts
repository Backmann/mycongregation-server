import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A talk can be set aside FOR A WHILE, and for a stated reason.
 *
 * Two things the catalogue could not say. The first: instructions sometimes
 * name a talk that is not to be given for a period — «до конца года», «пока не
 * выйдет исправленный план» — and afterwards it returns. Marked as retired for
 * good, it would have stayed out of every list until somebody remembered to
 * bring it back by hand, which is exactly the kind of remembering an
 * application exists to spare.
 *
 * The second: WHY. «Речь 92 снята» answers nothing a year later; «Объявления и
 * напоминания, май 2026» answers it completely. The reason is the sentence a
 * coordinator repeats to whoever asks, so it is stored beside the dates rather
 * than in a note somewhere else.
 *
 * `retired_until` null means «for good» — the ordinary case, and the one the
 * previous migration already covers.
 */
export class TalkRestrictionWindow1874000000000 implements MigrationInterface {
  name = 'TalkRestrictionWindow1874000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_talks" ADD COLUMN IF NOT EXISTS "retired_until" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_talks" ADD COLUMN IF NOT EXISTS "retired_reason" varchar(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public_talks" DROP COLUMN IF EXISTS "retired_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "public_talks" DROP COLUMN IF EXISTS "retired_until"`,
    );
  }
}
