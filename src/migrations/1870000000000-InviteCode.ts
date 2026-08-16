import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The second door into an invitation.
 *
 * Its own expiry rather than sharing the reset token's: asking to recover a
 * password sets that one to an hour, and an unrelated recovery should not
 * quietly kill an invitation that still had two days left.
 */
export class InviteCode1870000000000 implements MigrationInterface {
  name = 'InviteCode1870000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code_attempts" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_code_attempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_code_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_code_hash"`,
    );
  }
}
