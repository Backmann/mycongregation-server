import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPublisherSpecialNeedsFlags1813000000000 implements MigrationInterface {
  name = 'DropPublisherSpecialNeedsFlags1813000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "is_elderly_or_infirm"`,
    );
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "is_child"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "is_deaf"`);
    await queryRunner.query(`ALTER TABLE "publishers" DROP COLUMN "is_blind"`);
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "is_prisoner"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_prisoner" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_blind" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_deaf" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_child" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_elderly_or_infirm" boolean NOT NULL DEFAULT false`,
    );
  }
}
