import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-off bulk grant: give the "conducts field-service meeting"
 * (`fs_meeting_conductor`) capability to every active, baptized brother, so the
 * conductor picker isn't empty out of the gate. New publishers are granted it
 * individually via the capability editor afterwards.
 */
export class GrantFsMeetingConductorToBrothers1831000000000 implements MigrationInterface {
  name = 'GrantFsMeetingConductorToBrothers1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers"
       SET "capabilities" = jsonb_set(
         COALESCE("capabilities", '{}'::jsonb),
         '{fs_meeting_conductor}',
         'true'::jsonb
       )
       WHERE "gender" = 'brother'
         AND "baptism_date" IS NOT NULL
         AND "is_active" = true
         AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers"
       SET "capabilities" = "capabilities" - 'fs_meeting_conductor'
       WHERE "capabilities" ? 'fs_meeting_conductor'`,
    );
  }
}
