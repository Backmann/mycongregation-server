import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldServiceMonthThemes1829000000000 implements MigrationInterface {
  name = 'AddFieldServiceMonthThemes1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "field_service_month_themes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "theme" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_field_service_month_themes" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_fsmt_cong_year_month" ON "field_service_month_themes" ("congregation_id", "year", "month")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_fsmt_cong_year_month"`);
    await queryRunner.query(`DROP TABLE "field_service_month_themes"`);
  }
}
