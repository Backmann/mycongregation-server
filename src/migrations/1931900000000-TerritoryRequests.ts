import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Попросить участок» and the branch's S-54 behind the congregation's
 * boundary (17 November 2026).
 */
export class TerritoryRequests1931900000000 implements MigrationInterface {
  name = 'TerritoryRequests1931900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "closed_how" character varying(16),
        "closed_by_user_id" uuid,
        CONSTRAINT "PK_territory_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_territory_requests_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_requests_publisher" FOREIGN KEY ("publisher_id")
          REFERENCES "publishers"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_territory_requests_open"
         ON "territory_requests" ("congregation_id", "publisher_id")
         WHERE "closed_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "territory_boundaries" ADD COLUMN IF NOT EXISTS "s54_on" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "territory_boundaries" DROP COLUMN IF EXISTS "s54_on"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_requests"`);
  }
}
