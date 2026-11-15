import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A little more about each failure (15 November 2026): a failure with no
 * stack — «NetworkError: A network error occurred.» on the sign-in screen —
 * could not be traced. Now the app also says which event caught it, whether
 * the device was online, the place the browser names, and how long after the
 * start. Technical facts only, like the rest of the row; null from older
 * builds.
 */
export class ClientErrorContext1931200000000 implements MigrationInterface {
  name = 'ClientErrorContext1931200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_errors"
        ADD COLUMN IF NOT EXISTS "event" character varying(16),
        ADD COLUMN IF NOT EXISTS "online" boolean,
        ADD COLUMN IF NOT EXISTS "place" character varying(300),
        ADD COLUMN IF NOT EXISTS "since_start_s" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_errors"
        DROP COLUMN IF EXISTS "event",
        DROP COLUMN IF EXISTS "online",
        DROP COLUMN IF EXISTS "place",
        DROP COLUMN IF EXISTS "since_start_s"
    `);
  }
}
