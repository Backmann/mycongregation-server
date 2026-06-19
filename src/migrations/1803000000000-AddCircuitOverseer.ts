import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCircuitOverseer1803000000000 implements MigrationInterface {
  name = 'AddCircuitOverseer1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "circuit_overseers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "first_name" character varying(100) NOT NULL,
        "last_name" character varying(100) NOT NULL,
        "wife_name" character varying(100),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_circuit_overseers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_circuit_overseer_congregation" UNIQUE ("congregation_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_circuit_overseer_congregation" ON "circuit_overseers" ("congregation_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "circuit_overseers"
        ADD CONSTRAINT "FK_circuit_overseer_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "co_first_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "co_last_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "co_wife_name" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_wife_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_last_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_first_name"`,
    );
    await queryRunner.query(`DROP TABLE "circuit_overseers"`);
  }
}
