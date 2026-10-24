import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The field-service meetings a person deleted (24 October 2026), so that
 * preparing the month again does not bring them back — see
 * FieldServiceRemovedDay. Starts empty: a meeting deleted before today left
 * no trace to fill it from.
 */
export class FieldServiceRemovedDays1915000000000 implements MigrationInterface {
  name = 'FieldServiceRemovedDays1915000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "field_service_removed_days" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "date" date NOT NULL,
        "start_time" varchar(5) NOT NULL,
        "address" varchar(255) NOT NULL DEFAULT '',
        "service_group_id" uuid NULL,
        "is_general" boolean NOT NULL DEFAULT false,
        "removed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_field_service_removed_days_day" ON "field_service_removed_days" ("congregation_id", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "field_service_removed_days"`,
    );
  }
}
