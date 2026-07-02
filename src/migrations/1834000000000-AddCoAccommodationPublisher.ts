import { MigrationInterface, QueryRunner } from 'typeorm';

/** Circuit-overseer visit: optional publisher hosting the couple. */
export class AddCoAccommodationPublisher1834000000000 implements MigrationInterface {
  name = 'AddCoAccommodationPublisher1834000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events"
       ADD COLUMN IF NOT EXISTS "co_accommodation_publisher_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events"
       DROP COLUMN IF EXISTS "co_accommodation_publisher_id"`,
    );
  }
}
