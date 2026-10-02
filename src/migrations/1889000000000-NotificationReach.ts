import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дошло ли уведомление — и если нет, то почему.
 *
 * Журнал отправок писал «sent» каждой строке, даже когда у человека не было
 * ни телефона, ни подписки браузера: на 1 октября 2026 так ушло «в никуда»
 * около 40% записей. Теперь у строки три исхода и канал. А вход хранит то,
 * что само устройство сказало об уведомлениях, — сервер видит, что устройства
 * нет, но только устройство знает причину.
 *
 * Старые строки остаются как были: что с ними стало на самом деле, уже не
 * узнать, и переписывать их догадкой значило бы снова солгать журналу.
 */
export class NotificationReach1889000000000 implements MigrationInterface {
  name = 'NotificationReach1889000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification_outbox"
        ADD COLUMN IF NOT EXISTS "channel" varchar(8) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "push_state" varchar(24) NULL,
        ADD COLUMN IF NOT EXISTS "push_state_at" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "push_state_at",
        DROP COLUMN IF EXISTS "push_state"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_outbox" DROP COLUMN IF EXISTS "channel"
    `);
  }
}
