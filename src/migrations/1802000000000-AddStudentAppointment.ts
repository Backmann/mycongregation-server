import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'student' appointment — someone who shares in meeting parts
 * (ministry / Bible reading) without being a baptized or unbaptized publisher.
 *
 * Postgres enum values cannot be dropped, so down() is a no-op. ADD VALUE IF
 * NOT EXISTS keeps the migration idempotent.
 */
export class AddStudentAppointment1802000000000 implements MigrationInterface {
  name = 'AddStudentAppointment1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."publishers_appointment_enum" ADD VALUE IF NOT EXISTS 'student' BEFORE 'none'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums; leaving 'student' in place is safe.
  }
}
