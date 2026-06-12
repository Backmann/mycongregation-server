import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetToken1798000000000 implements MigrationInterface {
  name = 'AddPasswordResetToken1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "reset_token_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_reset_token" ON "users" ("reset_token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_reset_token"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "reset_token_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "reset_token_hash"`,
    );
  }
}
