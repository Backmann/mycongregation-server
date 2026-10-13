import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A field-service meeting may carry a notice for everyone (13 October 2026).
 *
 * The schedule is a habit: the same Saturday, the same hall, the same hour.
 * When the hall is under repair or taken by the pioneer school, the planner
 * could only rewrite the address or hide the reason in the theme — and the
 * theme is what the meeting is ABOUT, folded away under «Тема и материал»,
 * read in the programme as material rather than as a warning.
 *
 * `notice` is the short reason, drawn in amber wherever the meeting is drawn.
 * Nullable: a meeting without one changes nothing anywhere.
 */
export class FieldServiceMeetingNotice1900000000000 implements MigrationInterface {
  name = 'FieldServiceMeetingNotice1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "notice" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "notice"`,
    );
  }
}
