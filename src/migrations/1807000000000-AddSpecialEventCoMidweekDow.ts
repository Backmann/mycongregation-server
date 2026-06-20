import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialEventCoMidweekDow1807000000000 implements MigrationInterface {
  name = 'AddSpecialEventCoMidweekDow1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN IF NOT EXISTS "co_midweek_dow" smallint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "co_midweek_dow"`,
    );
  }
}
