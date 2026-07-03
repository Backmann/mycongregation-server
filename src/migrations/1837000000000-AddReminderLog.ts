import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotency ledger for cron-sent reminders. One row per (congregation,
 * kind, key) marks that a reminder was already delivered, so a delayed tick
 * or a restart on a window boundary can never double-send.
 *
 * kind: e.g. 'cleaning_after_meeting', 'cleaning_weekly_monday',
 *       'cleaning_weekly_planned'
 * key:  a stable per-occurrence discriminator, e.g. the local date plus the
 *       meeting/slot it refers to ('2026-05-20:midweek').
 */
export class AddReminderLog1837000000000 implements MigrationInterface {
  name = 'AddReminderLog1837000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reminder_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "kind" varchar(48) NOT NULL,
        "key" varchar(64) NOT NULL,
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reminder_log" PRIMARY KEY ("id"),
        CONSTRAINT "uq_reminder_log_cong_kind_key"
          UNIQUE ("congregation_id", "kind", "key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_reminder_log_sent_at"
       ON "reminder_log" ("sent_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "reminder_log"`);
  }
}
