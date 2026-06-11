import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHalls1797000000000 implements MigrationInterface {
  name = 'AddHalls1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "halls" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "address" character varying(255) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_halls" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_halls_congregation" ON "halls" ("congregation_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "halls"
        ADD CONSTRAINT "FK_halls_congregation"
        FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
        ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "halls"`);
  }
}
