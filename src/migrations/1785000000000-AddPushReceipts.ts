import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushReceipts1785000000000 implements MigrationInterface {
  name = 'AddPushReceipts1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE push_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id VARCHAR(255) NOT NULL UNIQUE,
        token VARCHAR(255) NOT NULL,
        user_id UUID NOT NULL,
        congregation_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_code VARCHAR(64),
        sent_at TIMESTAMPTZ NOT NULL,
        checked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_push_receipts_status_sent_at ON push_receipts(status, sent_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_push_receipts_token ON push_receipts(token)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_push_receipts_congregation ON push_receipts(congregation_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE push_receipts`);
  }
}
