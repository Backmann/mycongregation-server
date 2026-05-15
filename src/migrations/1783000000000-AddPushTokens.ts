import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushTokens1783000000000 implements MigrationInterface {
  name = 'AddPushTokens1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "congregation_id" uuid NOT NULL,
        "role" varchar(32) NOT NULL,
        "token" varchar(255) NOT NULL,
        "device_info" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_push_tokens_user_token"
        ON "push_tokens" ("user_id", "token")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_push_tokens_congregation_role"
        ON "push_tokens" ("congregation_id", "role")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_push_tokens_congregation_role"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_push_tokens_user_token"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "push_tokens"`);
  }
}
