import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What each person last used, kept on the PERSON rather than on a session.
 *
 * It lived on the session, and a session is written once — at sign-in, or when
 * a token is refreshed. So the list lagged behind reality by up to a quarter of
 * an hour of use, and often by a day: a brother installed the new build, opened
 * the app, and his row went on saying «Неизвестно» because nothing had created
 * a session since. That is the wrong shelf for a fact that changes.
 *
 * Presence — «в сети», «был вчера» — is already recorded on EVERY request and
 * already lives here. This is the same kind of fact and belongs beside it.
 *
 * The boundary is unchanged: a platform, a kind, an OS version, our own build
 * number. No device model, no address, no history — see the note on the session
 * columns, which stay as they are for the sessions screen.
 */
export class UserLastClient1862000000000 implements MigrationInterface {
  name = 'UserLastClient1862000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "client_platform" varchar(20) NULL,
        ADD COLUMN "client_kind" varchar(20) NULL,
        ADD COLUMN "client_os" varchar(20) NULL,
        ADD COLUMN "client_app_version" varchar(20) NULL,
        ADD COLUMN "client_seen_at" timestamptz NULL
    `);
    // Carry over what the sessions already know, so the screen is right from
    // the moment this runs rather than after everyone signs in again.
    await queryRunner.query(`
      UPDATE "users" u SET
        "client_platform" = s."client_platform",
        "client_kind" = s."client_kind",
        "client_os" = s."client_os",
        "client_app_version" = s."client_app_version",
        "client_seen_at" = GREATEST(s."last_used_at", s."created_at")
      FROM (
        SELECT DISTINCT ON ("user_id")
          "user_id", "client_platform", "client_kind",
          "client_os", "client_app_version", "last_used_at", "created_at"
        FROM "refresh_sessions"
        WHERE "client_platform" IS NOT NULL
        ORDER BY "user_id", GREATEST("last_used_at", "created_at") DESC
      ) s
      WHERE s."user_id" = u."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "client_seen_at",
        DROP COLUMN "client_app_version",
        DROP COLUMN "client_os",
        DROP COLUMN "client_kind",
        DROP COLUMN "client_platform"
    `);
  }
}
