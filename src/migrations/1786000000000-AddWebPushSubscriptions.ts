import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebPushSubscriptions1786000000000 implements MigrationInterface {
  name = 'AddWebPushSubscriptions1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE web_push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        congregation_id UUID NOT NULL,
        role VARCHAR(32) NOT NULL,
        endpoint VARCHAR(2048) NOT NULL UNIQUE,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        user_agent VARCHAR(512),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        last_failed_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_web_push_subs_congregation ON web_push_subscriptions(congregation_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_web_push_subs_user ON web_push_subscriptions(user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE web_push_subscriptions`);
  }
}
