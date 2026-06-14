import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePasswordHashNullable1799000000000 implements MigrationInterface {
  name = 'MakePasswordHashNullable1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Invited accounts are created without a password; the user sets it via
    // the invitation link (reset-password flow). password_hash becomes
    // nullable to represent "account exists, password not set yet".
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore NOT NULL. Any rows with a null password_hash (pending
    // invitations) would block this; clear them first if rolling back.
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`,
    );
  }
}
