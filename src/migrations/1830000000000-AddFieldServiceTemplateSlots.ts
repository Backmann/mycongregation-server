import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldServiceTemplateSlots1830000000000 implements MigrationInterface {
  name = 'AddFieldServiceTemplateSlots1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "field_service_template_slots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "position" integer NOT NULL,
        "ordinal" integer NOT NULL,
        "day_of_week" integer NOT NULL,
        "start_time" character varying(5) NOT NULL,
        "address" character varying(255) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_field_service_template_slots" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fsts_cong" ON "field_service_template_slots" ("congregation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fsts_cong"`);
    await queryRunner.query(`DROP TABLE "field_service_template_slots"`);
  }
}
