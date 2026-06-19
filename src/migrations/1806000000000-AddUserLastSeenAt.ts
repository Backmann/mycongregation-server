import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLastSeenAt1806000000000 implements MigrationInterface {
  name = 'AddUserLastSeenAt1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "last_seen_at"`,
    );
  }
}
