import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Up to when each person has read «Мои уведомления» — see InboxSeen.
 *
 * The messages themselves need no table: every notification has been written
 * to `notification_outbox` since July, text and addressee, whether or not a
 * device took it.
 */
export class InboxSeen1895000000000 implements MigrationInterface {
  name = 'InboxSeen1895000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbox_seen" (
        "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "seen_at" timestamptz NOT NULL
      )
    `);
    // The list is read per person, newest first.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_notification_outbox_user_created" ON "notification_outbox" ("user_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_notification_outbox_user_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "inbox_seen"`);
  }
}
