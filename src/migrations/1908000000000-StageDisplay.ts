import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The screen on the stage gets an account of its own (20 October 2026):
 * a role, a name, and the digits that open its menu
 * (common/enums/user-role.enum.ts, entities/user.entity.ts).
 *
 * `ADD VALUE IF NOT EXISTS` inside the migration's transaction, as
 * 1802000000000-AddStudentAppointment does: the value is not USED in this
 * transaction, which is what Postgres forbids. Enum values cannot be
 * dropped, so down() leaves it.
 */
export class StageDisplay1908000000000 implements MigrationInterface {
  name = 'StageDisplay1908000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'stage'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_label" varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stage_pin_hash" varchar(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "stage_pin_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "display_label"`,
    );
  }
}
