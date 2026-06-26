import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPublisherUnusedFlags1815000000000 implements MigrationInterface {
  name = 'DropPublisherUnusedFlags1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "is_anointed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "has_kingdom_hall_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "printed_watchtower"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "printed_workbook"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "sends_report_directly"`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" DROP COLUMN "spiritual_notes"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "spiritual_notes" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "sends_report_directly" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "printed_workbook" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "printed_watchtower" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "has_kingdom_hall_key" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "publishers" ADD "is_anointed" boolean NOT NULL DEFAULT false`,
    );
  }
}
