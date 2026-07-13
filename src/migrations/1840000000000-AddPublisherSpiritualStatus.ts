import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Publisher spiritual status (other sheep / anointed / unknown), needed for the
 * S-21 publisher record card. Defaults to 'unknown' so existing rows are valid.
 */
export class AddPublisherSpiritualStatus1840000000000 implements MigrationInterface {
  name = 'AddPublisherSpiritualStatus1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "publishers_spiritual_status_enum" AS ENUM
          ('other_sheep', 'anointed', 'unknown');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "publishers"
      ADD COLUMN IF NOT EXISTS "spiritual_status"
        "publishers_spiritual_status_enum" NOT NULL DEFAULT 'unknown';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publishers" DROP COLUMN IF EXISTS "spiritual_status";
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "publishers_spiritual_status_enum";
    `);
  }
}
