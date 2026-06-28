import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnerAndPresenceFlags1821000000000 implements MigrationInterface {
  name = 'AddOwnerAndPresenceFlags1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "is_owner" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "hide_presence" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "hide_presence"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_owner"`);
  }
}
