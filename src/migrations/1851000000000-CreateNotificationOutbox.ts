import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The outbox every automatic notification passes through.
 *
 * Until now each module sent straight to the push service with its own idea of
 * who and when, so nothing could be counted, a repeat was only prevented where
 * someone had thought to prevent it, and a job running at three in the morning
 * woke people up. One table answers all three: a dedupe key that makes a
 * second send impossible, a `not_before` that holds a message until a decent
 * hour, and a row per delivery to count.
 *
 * The unique index is partial on purpose — notifications that may legitimately
 * repeat carry no key, and NULLs must not collide with each other.
 */
export class CreateNotificationOutbox1851000000000 implements MigrationInterface {
  name = 'CreateNotificationOutbox1851000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "kind" character varying(48) NOT NULL,
        "dedupe_key" character varying(96),
        "not_before" TIMESTAMP WITH TIME ZONE,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "sent_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_notification_outbox" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_outbox_dedupe"
        ON "notification_outbox" ("congregation_id", "user_id", "dedupe_key")
        WHERE "dedupe_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_outbox_congregation"
        ON "notification_outbox" ("congregation_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_outbox_status"
        ON "notification_outbox" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_outbox_not_before"
        ON "notification_outbox" ("not_before")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_outbox"`);
  }
}
