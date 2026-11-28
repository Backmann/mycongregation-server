import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The server's 5xx, kept across restarts and deploys (28 November 2026): one
 * row per day, route pattern and error class, with a count. A pattern and a
 * class name only — no message, no parameter, no person. Before, the count
 * lived in memory and every deploy wiped it, mid-way through the week of
 * watching TypeORM 1.x's rule in production.
 */
export class ServerErrorsDaily1947000000000 implements MigrationInterface {
  name = 'ServerErrorsDaily1947000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "server_errors_daily" (
        "day" date NOT NULL,
        "route" varchar(200) NOT NULL,
        "kind" varchar(80) NOT NULL,
        "count" integer NOT NULL DEFAULT 1,
        "last_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_server_errors_daily" PRIMARY KEY ("day", "route", "kind")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "server_errors_daily"`);
  }
}
