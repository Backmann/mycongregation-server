import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCartShifts1819000000000 implements MigrationInterface {
  name = 'DropCartShifts1819000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_shift_participants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_shifts"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cart_shifts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "date" date NOT NULL, "start_time" character varying(5) NOT NULL, "end_time" character varying(5) NOT NULL, "location" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_shifts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_shifts_cong_date" ON "cart_shifts" ("congregation_id", "date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_shifts" ADD CONSTRAINT "fk_cart_shifts_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE TABLE "cart_shift_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cart_shift_id" uuid NOT NULL, "publisher_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_shift_participants" PRIMARY KEY ("id"), CONSTRAINT "uq_cart_participant" UNIQUE ("cart_shift_id", "publisher_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_participants_shift" ON "cart_shift_participants" ("cart_shift_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_shift_participants" ADD CONSTRAINT "fk_cart_participant_shift" FOREIGN KEY ("cart_shift_id") REFERENCES "cart_shifts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_shift_participants" ADD CONSTRAINT "fk_cart_participant_publisher" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE`,
    );
  }
}
