import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auxiliary pioneer service periods (Служение → Подсобное пионерское
 * служение). One row per publisher period; the monthly hour goal is computed,
 * not stored.
 */
export class CreateAuxiliaryPioneers1839000000000 implements MigrationInterface {
  name = 'CreateAuxiliaryPioneers1839000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auxiliary_pioneers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "start_month" date NOT NULL,
        "end_month" date,
        "until_cancelled" boolean NOT NULL DEFAULT false,
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auxiliary_pioneers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auxiliary_pioneers_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_auxiliary_pioneers_publisher"
          FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auxiliary_pioneers_cong_pub"
       ON "auxiliary_pioneers" ("congregation_id", "publisher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auxiliary_pioneers_cong_start"
       ON "auxiliary_pioneers" ("congregation_id", "start_month")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auxiliary_pioneers"`);
  }
}
