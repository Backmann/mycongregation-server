import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResponsibilities1781000000000 implements MigrationInterface {
  name = 'AddResponsibilities1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "responsibilities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "type" character varying(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "assigned_by" uuid,
        "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_responsibilities" PRIMARY KEY ("id"),
        CONSTRAINT "uq_responsibilities_cong_type" UNIQUE ("congregation_id", "type")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_responsibilities_congregation" ON "responsibilities" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_responsibilities_user" ON "responsibilities" ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities"
       ADD CONSTRAINT "fk_responsibilities_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities"
       ADD CONSTRAINT "fk_responsibilities_user"
       FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities"
       ADD CONSTRAINT "fk_responsibilities_assigned_by"
       FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "responsibilities" DROP CONSTRAINT "fk_responsibilities_assigned_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities" DROP CONSTRAINT "fk_responsibilities_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responsibilities" DROP CONSTRAINT "fk_responsibilities_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "responsibilities"`);
  }
}
