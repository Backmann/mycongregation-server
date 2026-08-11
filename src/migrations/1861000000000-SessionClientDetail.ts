import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which Android, and which build of ours.
 *
 * The first version of this recorded a platform and a kind, and on real phones
 * the platform came out as «неизвестно» — because a React Native app signs its
 * requests `okhttp/4.x` and says nothing else. Browsers describe themselves
 * honestly; our own app was the one client telling the server nothing, and the
 * server was left guessing about the very thing it could simply be told.
 *
 * These two columns hold what the app now states outright. The app version is
 * the useful half: it answers «кому нужно помочь обновиться» directly, instead
 * of leaving an administrator to ask each brother in turn.
 *
 * THE BOUNDARY IS UNCHANGED and deliberately so: a platform, an OS version, our
 * own build number, and a date. No device model, no IP address, no browser
 * build. Managing access, not watching brothers.
 */
export class SessionClientDetail1861000000000 implements MigrationInterface {
  name = 'SessionClientDetail1861000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
        ADD COLUMN "client_os" varchar(20) NULL,
        ADD COLUMN "client_app_version" varchar(20) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
        DROP COLUMN "client_app_version",
        DROP COLUMN "client_os"
    `);
  }
}
