import { MigrationInterface, QueryRunner } from 'typeorm';

/** «He goes» on a trip marked in question (23 October 2026). */
export class TalkExchangeRiskAck1911000000000 implements MigrationInterface {
  name = 'TalkExchangeRiskAck1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "risk_ack_reason" varchar(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "risk_ack_reason"`,
    );
  }
}
