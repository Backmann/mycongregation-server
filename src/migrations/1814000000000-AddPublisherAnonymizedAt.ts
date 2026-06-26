import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublisherAnonymizedAt1814000000000 implements MigrationInterface {
  name = 'AddPublisherAnonymizedAt1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "anonymized_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "anonymized_at"`,
    );
  }
}
