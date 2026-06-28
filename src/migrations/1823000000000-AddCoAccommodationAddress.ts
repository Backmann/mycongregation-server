import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoAccommodationAddress1823000000000 implements MigrationInterface {
  name = 'AddCoAccommodationAddress1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD "co_accommodation_address" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "co_accommodation_address"`,
    );
  }
}
