import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A pioneer's own hours log (Lionel, 29 October 2026).
 * See entities/service-log-entry.entity.ts.
 */
export class ServiceLogEntries1926000000000 implements MigrationInterface {
  name = 'ServiceLogEntries1926000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_log_entries" (
        "id" uuid NOT NULL,
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "day" date NOT NULL,
        "minutes" integer NOT NULL,
        "kind" varchar(8) NOT NULL DEFAULT 'field',
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_log_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_log_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_log_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_service_log_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_service_log_kind" CHECK ("kind" IN ('field', 'credit')),
        CONSTRAINT "CHK_service_log_minutes" CHECK ("minutes" > 0 AND "minutes" <= 720)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_log_owner_day" ON "service_log_entries" ("congregation_id", "publisher_id", "day")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_service_log_user" ON "service_log_entries" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "service_log_entries"`);
  }
}
