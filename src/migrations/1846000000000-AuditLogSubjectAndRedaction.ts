import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two things the journal could not express.
 *
 * `subject_id` — WHOM a change is about, when that is not the person who made
 * it. The secretary entering a report for a brother, an elder editing someone
 * else's card: with only an actor recorded, the journal reads as though the
 * secretary changed his own report, which is exactly backwards in the moment
 * a journal is consulted.
 *
 * `redacted_at` — when the values in this row were cleared because the person
 * they concern asked to be erased. The row is kept, emptied: that a change
 * happened, by whom and when, is the congregation's record and stays; the
 * personal values in it are that person's and go. Deleting the row outright
 * would let an erasure request quietly remove evidence of someone else's
 * actions.
 */
export class AuditLogSubjectAndRedaction1846000000000 implements MigrationInterface {
  name = 'AuditLogSubjectAndRedaction1846000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "subject_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "redacted_at" TIMESTAMP WITH TIME ZONE`,
    );
    // "everything about this person" is the question an erasure request and a
    // dispute both ask, so it gets its own index.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_subject" ON "audit_logs" ("congregation_id", "subject_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_subject"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "redacted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "subject_id"`,
    );
  }
}
