import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh tokens become revocable. One row per signed-in device, holding a
 * SHA-256 digest of the issued token rather than the token itself.
 *
 * Column names are snake_case (SnakeNamingStrategy).
 */
export class AddRefreshSessions1845000000000 implements MigrationInterface {
  name = 'AddRefreshSessions1845000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_refresh_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_user_id" ON "refresh_sessions" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_sessions_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_sessions"`);
  }
}
