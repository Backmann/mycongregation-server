import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No status by hand (1 November 2026): every hand-set status is let go, and
 * the nightly recompute decides it from the reports. The live preview the
 * same day counted none held, so this changes nothing there; it makes sure
 * no frozen status is left anywhere.
 */
export class ReleaseHandSetStatuses1927000000000 implements MigrationInterface {
  name = 'ReleaseHandSetStatuses1927000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers"
          SET "status_manually_overridden" = false,
              "status_overridden_by_id" = NULL,
              "status_overridden_at" = NULL
        WHERE "status_manually_overridden" = true`,
    );
  }

  public async down(): Promise<void> {
    // Who was frozen is not kept; nothing to put back.
  }
}
