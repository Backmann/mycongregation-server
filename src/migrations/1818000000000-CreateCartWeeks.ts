import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCartWeeks1818000000000 implements MigrationInterface {
  name = 'CreateCartWeeks1818000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cart_weeks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "week_start_date" date NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'draft', "start_time" character varying(5) NOT NULL, "end_time" character varying(5) NOT NULL, "step_minutes" smallint NOT NULL, "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_weeks" PRIMARY KEY ("id"), CONSTRAINT "uq_cart_week_congregation_week" UNIQUE ("congregation_id", "week_start_date"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_weeks" ADD CONSTRAINT "FK_cart_weeks_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "cart_slots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "week_id" uuid NOT NULL, "date" date NOT NULL, "start_time" character varying(5) NOT NULL, "end_time" character varying(5) NOT NULL, "location_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_slots" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_slots_cong_date" ON "cart_slots" ("congregation_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_slots_week" ON "cart_slots" ("week_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD CONSTRAINT "FK_cart_slots_week" FOREIGN KEY ("week_id") REFERENCES "cart_weeks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD CONSTRAINT "FK_cart_slots_location" FOREIGN KEY ("location_id") REFERENCES "cart_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD CONSTRAINT "FK_cart_slots_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "cart_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "slot_id" uuid NOT NULL, "publisher_id" uuid NOT NULL, "with_whom_note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_requests" PRIMARY KEY ("id"), CONSTRAINT "uq_cart_request_slot_publisher" UNIQUE ("slot_id", "publisher_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_requests_slot" ON "cart_requests" ("slot_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_requests" ADD CONSTRAINT "FK_cart_requests_slot" FOREIGN KEY ("slot_id") REFERENCES "cart_slots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_requests" ADD CONSTRAINT "FK_cart_requests_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_requests" ADD CONSTRAINT "FK_cart_requests_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cart_requests"`);
    await queryRunner.query(`DROP TABLE "cart_slots"`);
    await queryRunner.query(`DROP TABLE "cart_weeks"`);
  }
}
