import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldServiceMeetings1784000000000 implements MigrationInterface {
  name = 'AddFieldServiceMeetings1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "field_service_meetings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "day_of_week" smallint NOT NULL,
        "start_time" character varying(5) NOT NULL,
        "address" character varying(255) NOT NULL,
        "conductor_publisher_id" uuid,
        "topic" text,
        "source_url" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_field_service_meetings" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fsm_cong_week" ON "field_service_meetings" ("congregation_id", "week_start_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fsm_cong_conductor" ON "field_service_meetings" ("congregation_id", "conductor_publisher_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings"
       ADD CONSTRAINT "fk_fsm_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings"
       ADD CONSTRAINT "fk_fsm_conductor"
       FOREIGN KEY ("conductor_publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT "fk_fsm_conductor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT "fk_fsm_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "field_service_meetings"`);
  }
}
