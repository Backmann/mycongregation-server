import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleaningAssignments1785000000000 implements MigrationInterface {
  name = 'AddCleaningAssignments1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cleaning_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "slot_type" character varying(24) NOT NULL,
        "service_group_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cleaning_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "uq_cleaning_slot" UNIQUE ("congregation_id", "week_start_date", "slot_type")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cleaning_cong_week" ON "cleaning_assignments" ("congregation_id", "week_start_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments"
       ADD CONSTRAINT "fk_cleaning_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments"
       ADD CONSTRAINT "fk_cleaning_service_group"
       FOREIGN KEY ("service_group_id") REFERENCES "service_groups"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "fk_cleaning_service_group"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "fk_cleaning_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "cleaning_assignments"`);
  }
}
