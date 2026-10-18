import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The device that taps, on the meeting as it runs (18 October 2026): one
 * device of an account runs it, the account's other devices watch
 * (entities/conduct-live.entity.ts). Rows so far have none and stay heard
 * from any device of their account.
 */
export class ConductLiveDevice1907000000000 implements MigrationInterface {
  name = 'ConductLiveDevice1907000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conduct_live" ADD COLUMN IF NOT EXISTS "controller_device_id" varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conduct_live" DROP COLUMN IF EXISTS "controller_device_id"`,
    );
  }
}
