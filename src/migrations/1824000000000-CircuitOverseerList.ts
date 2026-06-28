import { MigrationInterface, QueryRunner } from 'typeorm';

export class CircuitOverseerList1824000000000 implements MigrationInterface {
  name = 'CircuitOverseerList1824000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" DROP CONSTRAINT "uq_circuit_overseer_congregation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" ADD "role" character varying(20) NOT NULL DEFAULT 'overseer'`,
    );
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" ADD "is_primary" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "circuit_overseers" SET "is_primary" = true`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_circuit_overseer_primary" ON "circuit_overseers" ("congregation_id") WHERE "is_primary" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_circuit_overseer_primary"`);
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" DROP COLUMN "is_primary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" DROP COLUMN "role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "circuit_overseers" ADD CONSTRAINT "uq_circuit_overseer_congregation" UNIQUE ("congregation_id")`,
    );
  }
}
