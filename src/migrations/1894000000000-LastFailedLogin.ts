import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When an account was last turned away at the door, and why.
 *
 * The sign-in form says one sentence for every refusal; the reason went to
 * the server log, which starts again at every deploy. An elder helping
 * somebody who «cannot get in» had nothing to look at.
 */
export class LastFailedLogin1894000000000 implements MigrationInterface {
  name = 'LastFailedLogin1894000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_failed_login_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_failed_login_reason" varchar(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "last_failed_login_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "last_failed_login_at"`,
    );
  }
}
