import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What each session is being used FROM.
 *
 * The app could already say «Дина была в сети вчера» and nothing about how she
 * got there — and «how» is the question an administrator actually needs. A
 * brother signing in from a browser has no push notifications reaching him;
 * one on the installed app does. Until now the only trace of a platform came
 * from a push token, which exists solely for people who already allowed
 * notifications — that is, exactly the people there was nothing to worry about.
 *
 * DELIBERATELY COARSE, and this is Lionel's boundary, agreed in as many words:
 * the platform, the kind of client, and the date. No IP address, no browser
 * version, no device model, no history of where somebody has been. That is the
 * difference between managing access and watching brothers.
 */
export class SessionClient1860000000000 implements MigrationInterface {
  name = 'SessionClient1860000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
        ADD COLUMN "client_platform" varchar(20) NULL,
        ADD COLUMN "client_kind" varchar(20) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
        DROP COLUMN "client_kind",
        DROP COLUMN "client_platform"
    `);
  }
}
