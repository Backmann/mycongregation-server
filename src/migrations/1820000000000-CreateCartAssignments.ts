import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCartAssignments1820000000000 implements MigrationInterface {
  name = 'CreateCartAssignments1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cart_assignments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "slot_id" uuid NOT NULL, "publisher_id" uuid, "external_name" text, "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_assignments" PRIMARY KEY ("id"), CONSTRAINT "uq_cart_assignment_slot_publisher" UNIQUE ("slot_id", "publisher_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_assignments_slot" ON "cart_assignments" ("slot_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_assignments" ADD CONSTRAINT "FK_cart_assignments_slot" FOREIGN KEY ("slot_id") REFERENCES "cart_slots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_assignments" ADD CONSTRAINT "FK_cart_assignments_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_assignments" ADD CONSTRAINT "FK_cart_assignments_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cart_assignments"`);
  }
}
