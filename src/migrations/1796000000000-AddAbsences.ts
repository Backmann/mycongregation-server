import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAbsences1796000000000 implements MigrationInterface {
  name = 'AddAbsences1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "absences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date,
        "note" text,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_absences" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_absences_congregation" ON "absences" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_absences_publisher" ON "absences" ("publisher_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_absences_pub_start" ON "absences" ("publisher_id", "start_date")`,
    );
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "FK_absences_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
        ADD CONSTRAINT "FK_absences_publisher"
        FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id")
        ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "absences"`);
  }
}
