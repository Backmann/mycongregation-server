import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialEventEndDate1794000000000 implements MigrationInterface {
  name = 'AddSpecialEventEndDate1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "end_date" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "end_date"`,
    );
  }
}
