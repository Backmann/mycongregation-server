import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A meeting moved for one week (4 November 2026). The rules the app relies on
 * are held here, not only in code: one move per meeting per week, the new day
 * inside that same week, the week given by its Monday, a real HH:MM hour.
 */
export class MeetingMoves1928400000000 implements MigrationInterface {
  name = 'MeetingMoves1928400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meeting_moves" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "week_start_date" date NOT NULL,
        "event_type" character varying(10) NOT NULL,
        "date" date NOT NULL,
        "time" character varying(5) NOT NULL,
        "address" text,
        "moved_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meeting_moves" PRIMARY KEY ("id"),
        CONSTRAINT "uq_meeting_move_week_kind" UNIQUE ("congregation_id", "week_start_date", "event_type"),
        CONSTRAINT "ck_meeting_move_kind" CHECK ("event_type" IN ('midweek', 'weekend')),
        CONSTRAINT "ck_meeting_move_monday" CHECK (EXTRACT(ISODOW FROM "week_start_date") = 1),
        CONSTRAINT "ck_meeting_move_same_week" CHECK ("date" BETWEEN "week_start_date" AND "week_start_date" + 6),
        CONSTRAINT "ck_meeting_move_time" CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      )`);
    await queryRunner.query(
      `ALTER TABLE "meeting_moves" ADD CONSTRAINT "FK_meeting_moves_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "meeting_moves"`);
  }
}
