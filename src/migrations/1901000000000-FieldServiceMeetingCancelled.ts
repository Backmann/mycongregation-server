import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A field-service meeting may be CANCELLED and stay in sight (13 October 2026).
 *
 * Until now the only way to call a Saturday off was to delete it: the
 * meeting vanished from the Home screen and the programme, the conductor got
 * one line, and everyone else — the group or the whole congregation, who
 * were going — learned nothing. A meeting that is simply not there reads as
 * «I must have missed it», not as «it was called off».
 *
 * `cancelled_at` — when it was called off; null for a meeting that holds.
 * `cancel_reason` — the short word drawn under the crossed-out line.
 * Restoring clears both. Deleting stays for drafts and mistakes.
 */
export class FieldServiceMeetingCancelled1901000000000 implements MigrationInterface {
  name = 'FieldServiceMeetingCancelled1901000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "cancel_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "cancel_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "cancelled_at"`,
    );
  }
}
