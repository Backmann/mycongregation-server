import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Not every change is made by a person.
 *
 * Assignments alone are written by nine services, several of which run without
 * anyone signed in: the nightly duty automation, the EPUB import, the sync
 * between the schedule and the talk coordinator's journal. Until now
 * `actor_user_id` was NOT NULL, so those changes simply could not be recorded
 * — which is how a journal ends up with holes exactly where nobody was
 * watching.
 *
 * `actor_user_id` becomes nullable and `source` says why it is null. An
 * explicit 'system' is the point: a null actor with no explanation is
 * indistinguishable from a bug where somebody forgot to pass the user.
 */
export class AuditLogSystemActor1847000000000 implements MigrationInterface {
  name = 'AuditLogSystemActor1847000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "source" varchar(16) NOT NULL DEFAULT 'user'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "source"`,
    );
    // Rows written by the system have no actor and would block the constraint;
    // they are dropped rather than given a fake one.
    await queryRunner.query(
      `DELETE FROM "audit_logs" WHERE "actor_user_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "actor_user_id" SET NOT NULL`,
    );
  }
}
