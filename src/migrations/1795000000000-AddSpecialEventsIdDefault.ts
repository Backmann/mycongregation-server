import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialEventsIdDefault1795000000000 implements MigrationInterface {
  name = 'AddSpecialEventsIdDefault1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ALTER COLUMN "id" DROP DEFAULT`,
    );
  }
}
