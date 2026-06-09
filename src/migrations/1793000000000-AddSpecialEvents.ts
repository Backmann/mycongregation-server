import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialEvents1793000000000 implements MigrationInterface {
  name = 'AddSpecialEvents1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "special_events" (
        "id" uuid NOT NULL,
        "congregation_id" uuid NOT NULL,
        "title" character varying(255) NOT NULL,
        "type" character varying(50),
        "date" date NOT NULL,
        "time" character varying(50),
        "address" text,
        "map_url" text,
        "program_url" text,
        "note" text,
        "replaces_meeting" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_special_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_special_events_congregation" ON "special_events" ("congregation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_special_events_date" ON "special_events" ("date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_special_events_date"`);
    await queryRunner.query(`DROP INDEX "IDX_special_events_congregation"`);
    await queryRunner.query(`DROP TABLE "special_events"`);
  }
}
