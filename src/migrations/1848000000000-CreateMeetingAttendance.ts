import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Meeting attendance (form S-3): one row per meeting held, holding the number
 * of everyone present — publishers, children, guests alike.
 *
 * Keyed by the meeting's OWN CALENDAR DATE rather than by the week it belongs
 * to. The form is organised by calendar month, a week can straddle two months,
 * and a circuit overseer's visit moves a meeting to a different day; the date
 * survives all three, a week number does not.
 *
 * `not_held` records a meeting that did not take place — an assembly week, the
 * Memorial, a convention. That is NOT the same as "nobody has entered it yet",
 * and the difference decides the monthly average: it is divided by the number
 * of meetings actually HELD.
 */
export class CreateMeetingAttendance1848000000000 implements MigrationInterface {
  name = 'CreateMeetingAttendance1848000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meeting_attendance" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "date" date NOT NULL,
        "event_type" varchar(16) NOT NULL,
        "count" integer,
        "not_held" boolean NOT NULL DEFAULT false,
        "note" text,
        "recorded_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meeting_attendance" PRIMARY KEY ("id"),
        CONSTRAINT "FK_meeting_attendance_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_meeting_attendance_recorded_by"
          FOREIGN KEY ("recorded_by") REFERENCES "users"("id")
          ON DELETE SET NULL,
        -- One meeting, one figure. A second entry for the same meeting would
        -- silently double a month's total.
        CONSTRAINT "UQ_meeting_attendance_meeting"
          UNIQUE ("congregation_id", "date", "event_type"),
        -- Either it was held and counted, or it was not held at all.
        CONSTRAINT "CK_meeting_attendance_count"
          CHECK (("not_held" = true AND "count" IS NULL)
              OR ("not_held" = false AND "count" >= 0))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meeting_attendance_cong_date"
        ON "meeting_attendance" ("congregation_id", "date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meeting_attendance_cong_date"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meeting_attendance"`);
  }
}
