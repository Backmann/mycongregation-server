import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalCongregations1808000000000 implements MigrationInterface {
  name = 'AddExternalCongregations1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "external_congregations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "name" text NOT NULL,
        "city" text,
        "contact_name" text,
        "contact_phone" text,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_external_congregations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_external_congregations_congregation" ON "external_congregations" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_external_congregations_cong_name" ON "external_congregations" ("congregation_id", "name")`,
    );
    await queryRunner.query(`
      ALTER TABLE "external_congregations"
        ADD CONSTRAINT "FK_external_congregations_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "external_congregations"`);
  }
}
