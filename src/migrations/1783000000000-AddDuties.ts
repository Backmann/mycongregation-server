import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDuties1783000000000 implements MigrationInterface {
  name = 'AddDuties1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "duties" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" character varying(16) NOT NULL,
        "duty_type" character varying(32) NOT NULL,
        "slot_index" integer NOT NULL DEFAULT 0,
        "custom_label" character varying(255),
        "publisher_id" uuid,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_duties" PRIMARY KEY ("id"),
        CONSTRAINT "uq_duty_slot" UNIQUE ("congregation_id", "week_start_date", "event_type", "duty_type", "slot_index")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duties_cong_week_event" ON "duties" ("congregation_id", "week_start_date", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_duties_cong_publisher" ON "duties" ("congregation_id", "publisher_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "duties"
       ADD CONSTRAINT "fk_duties_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "duties"
       ADD CONSTRAINT "fk_duties_publisher"
       FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "duties" DROP CONSTRAINT "fk_duties_publisher"`,
    );
    await queryRunner.query(
      `ALTER TABLE "duties" DROP CONSTRAINT "fk_duties_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "duties"`);
  }
}
