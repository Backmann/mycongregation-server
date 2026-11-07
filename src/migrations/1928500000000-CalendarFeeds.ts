import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Calendar subscriptions (7 November 2026): a secret link per login that a
 * phone's calendar reads the agenda through. Found by the hash of its token;
 * the token itself is stored encrypted, so it can be shown again.
 */
export class CalendarFeeds1928500000000 implements MigrationInterface {
  name = 'CalendarFeeds1928500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "calendar_feeds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "token" text NOT NULL,
        "include_mine" boolean NOT NULL DEFAULT true,
        "include_events" boolean NOT NULL DEFAULT true,
        "include_names" boolean NOT NULL DEFAULT true,
        "last_fetched_at" TIMESTAMP WITH TIME ZONE,
        "last_client" character varying(16),
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" character varying(24),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_calendar_feeds" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_calendar_feeds_user" UNIQUE ("user_id"),
        CONSTRAINT "ck_calendar_feeds_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_calendar_feeds_token_hash" ON "calendar_feeds" ("token_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_feeds" ADD CONSTRAINT "FK_calendar_feeds_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_feeds" ADD CONSTRAINT "FK_calendar_feeds_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "calendar_feeds"`);
  }
}
