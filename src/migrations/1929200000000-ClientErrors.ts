import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The journal of failures met in the app (10 November 2026). See
 * entities/client-error.entity.ts — technical facts only, thirty days.
 */
export class ClientErrors1929200000000 implements MigrationInterface {
  name = 'ClientErrors1929200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_errors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "day" date NOT NULL,
        "fingerprint" character varying(64) NOT NULL,
        "platform" character varying(16) NOT NULL,
        "app_commit" character varying(64),
        "route" character varying(200) NOT NULL,
        "role" character varying(32),
        "source" character varying(16) NOT NULL,
        "message" character varying(300) NOT NULL,
        "stack" character varying(1500),
        "count" integer NOT NULL DEFAULT 1,
        "first_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_client_errors" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_errors_day_fingerprint" ON "client_errors" ("day", "fingerprint")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_errors"`);
  }
}
