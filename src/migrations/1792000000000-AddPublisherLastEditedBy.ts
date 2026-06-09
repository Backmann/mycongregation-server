import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublisherLastEditedBy1792000000000 implements MigrationInterface {
  name = 'AddPublisherLastEditedBy1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD COLUMN "last_edited_by_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "last_edited_by_id"`,
    );
  }
}
