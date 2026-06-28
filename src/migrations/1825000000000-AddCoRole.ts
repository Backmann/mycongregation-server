import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoRole1825000000000 implements MigrationInterface {
  name = 'AddCoRole1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD "co_role" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_role"`,
    );
  }
}
