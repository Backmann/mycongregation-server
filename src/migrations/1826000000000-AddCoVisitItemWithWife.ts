import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoVisitItemWithWife1826000000000 implements MigrationInterface {
  name = 'AddCoVisitItemWithWife1826000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" ADD "with_wife" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "co_visit_items" DROP COLUMN "with_wife"`,
    );
  }
}
