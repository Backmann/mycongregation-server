import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublisherStatus1782000000000 implements MigrationInterface {
  name = 'AddPublisherStatus1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publishers"
        ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'inactive',
        ADD COLUMN "status_manually_overridden" boolean NOT NULL DEFAULT false,
        ADD COLUMN "status_overridden_by_id" uuid,
        ADD COLUMN "status_overridden_at" timestamptz
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_publishers_status"
        ON "publishers" ("congregation_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_publishers_status"`);
    await queryRunner.query(`
      ALTER TABLE "publishers"
        DROP COLUMN IF EXISTS "status_overridden_at",
        DROP COLUMN IF EXISTS "status_overridden_by_id",
        DROP COLUMN IF EXISTS "status_manually_overridden",
        DROP COLUMN IF EXISTS "status"
    `);
  }
}
