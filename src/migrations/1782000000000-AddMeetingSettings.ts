import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeetingSettings1782000000000 implements MigrationInterface {
  name = 'AddMeetingSettings1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "meeting_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "effective_from" date NOT NULL,
        "midweek_dow" smallint NOT NULL,
        "midweek_time" character varying(5) NOT NULL,
        "weekend_dow" smallint NOT NULL,
        "weekend_time" character varying(5) NOT NULL,
        "address" text NOT NULL,
        "microphone_slots" smallint NOT NULL DEFAULT 2,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meeting_settings" PRIMARY KEY ("id"),
        CONSTRAINT "uq_meeting_settings_cong_effective" UNIQUE ("congregation_id", "effective_from")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_meeting_settings_cong_effective" ON "meeting_settings" ("congregation_id", "effective_from")`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_settings"
       ADD CONSTRAINT "fk_meeting_settings_congregation"
       FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_settings" DROP CONSTRAINT "fk_meeting_settings_congregation"`,
    );
    await queryRunner.query(`DROP TABLE "meeting_settings"`);
  }
}
