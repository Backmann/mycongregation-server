import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Attendance, 31 October 2026 (Lionel): the figure is still ONE number — the
 * one that goes into S-3, S-1 and S-10 — but the part of it that joined by
 * video may be kept beside it «для понимания». And a meeting that was not
 * held says why, briefly, so a grey cell still means something a year later.
 */
export class AttendanceOnlineReason1926500000000 implements MigrationInterface {
  name = 'AttendanceOnlineReason1926500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" ADD COLUMN IF NOT EXISTS "online_count" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" ADD COLUMN IF NOT EXISTS "not_held_reason" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP CONSTRAINT IF EXISTS "ck_meeting_attendance_online"`,
    );
    // Part of the figure, never more than it, and only where there is one.
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" ADD CONSTRAINT "ck_meeting_attendance_online" CHECK (
        "online_count" IS NULL
        OR ("count" IS NOT NULL AND "online_count" >= 0 AND "online_count" <= "count")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP CONSTRAINT IF EXISTS "ck_meeting_attendance_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" ADD CONSTRAINT "ck_meeting_attendance_reason" CHECK (
        "not_held_reason" IS NULL
        OR ("not_held" = true AND "not_held_reason" IN ('weather', 'hall', 'other'))
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP CONSTRAINT IF EXISTS "ck_meeting_attendance_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP CONSTRAINT IF EXISTS "ck_meeting_attendance_online"`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP COLUMN IF EXISTS "not_held_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "meeting_attendance" DROP COLUMN IF EXISTS "online_count"`,
    );
  }
}
