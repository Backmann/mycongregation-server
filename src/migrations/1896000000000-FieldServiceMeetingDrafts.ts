import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A field-service meeting may now be a DRAFT: prepared, not yet announced.
 *
 * `published_at` is the moment the congregation was told. Null is a draft —
 * the service overseer sees it, nobody else does, and no conductor is
 * notified about it until the month is published as a whole.
 *
 * Every meeting on record so far was announced the moment it was made, so
 * each gets its creation time: nothing anybody can see today disappears.
 */
export class FieldServiceMeetingDrafts1896000000000 implements MigrationInterface {
  name = 'FieldServiceMeetingDrafts1896000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "published_at" timestamptz NULL`,
    );
    await queryRunner.query(
      `UPDATE "field_service_meetings" SET "published_at" = "created_at" WHERE "published_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "published_at"`,
    );
  }
}
