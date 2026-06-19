import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialEventCoRevertData1804000000000 implements MigrationInterface {
  name = 'AddSpecialEventCoRevertData1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "co_revert_data" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_revert_data"`,
    );
  }
}
