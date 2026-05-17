import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserUiLanguage1784000000000 implements MigrationInterface {
  name = 'AddUserUiLanguage1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN ui_language VARCHAR(2) NOT NULL DEFAULT 'ru'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN ui_language`);
  }
}
