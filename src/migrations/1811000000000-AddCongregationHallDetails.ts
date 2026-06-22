import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCongregationHallDetails1811000000000 implements MigrationInterface {
  name = 'AddCongregationHallDetails1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "external_congregations" ADD "address" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" ADD "meeting_dow" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" ADD "meeting_time" character varying(5)`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" ADD "map_url" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "external_congregations" DROP COLUMN "map_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" DROP COLUMN "meeting_time"`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" DROP COLUMN "meeting_dow"`,
    );
    await queryRunner.query(
      `ALTER TABLE "external_congregations" DROP COLUMN "address"`,
    );
  }
}
