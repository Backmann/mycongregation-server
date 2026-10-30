import { MigrationInterface, QueryRunner } from 'typeorm';

/** The annual meeting of the elders with the pioneers (S-211). */
export class PioneerMeetings1926400000000 implements MigrationInterface {
  name = 'PioneerMeetings1926400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "pioneer_meetings" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "congregation_id" uuid NOT NULL,
      "date" date NOT NULL,
      "time_start" character varying(5),
      "time_end" character varying(5),
      "place" character varying(200),
      "conductor_publisher_id" uuid NOT NULL,
      "note" text,
      "created_by_id" uuid,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_pioneer_meetings" PRIMARY KEY ("id"),
      CONSTRAINT "FK_pioneer_meetings_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_pioneer_meetings_conductor" FOREIGN KEY ("conductor_publisher_id") REFERENCES "publishers"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pioneer_meetings_cong_date" ON "pioneer_meetings" ("congregation_id", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_meetings"`);
  }
}
