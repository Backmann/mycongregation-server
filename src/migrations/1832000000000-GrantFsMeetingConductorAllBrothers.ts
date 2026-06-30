import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to 1831: the earlier grant required a baptism date, which many
 * brothers don't have filled in, leaving their toggle off. Per the request to
 * give it to *all* brothers, grant `fs_meeting_conductor` to every active
 * (non-removed) brother regardless of baptism date.
 */
export class GrantFsMeetingConductorAllBrothers1832000000000 implements MigrationInterface {
  name = 'GrantFsMeetingConductorAllBrothers1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers"
       SET "capabilities" = jsonb_set(
         COALESCE("capabilities", '{}'::jsonb),
         '{fs_meeting_conductor}',
         'true'::jsonb
       )
       WHERE "gender" = 'brother'
         AND "is_active" = true
         AND "deleted_at" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    // No-op: leave existing grants in place (1831 down handles removal).
  }
}
