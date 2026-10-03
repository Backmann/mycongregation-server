import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * На каком устройстве живёт подписка браузера.
 *
 * До 3 октября 2026 действовало «один человек — один канал»: если у человека
 * есть телефон с приложением, все его браузеры молчат. Это глушило и iPhone с
 * iPad, которые этим телефоном быть не могут. Новое правило — «одно
 * уведомление на физическое устройство», и для него нужно знать, что за
 * устройство. Строка браузера этого не говорит: iPad представляется как Mac.
 * Поэтому устройство сообщает о себе само, а пустое значение читается по
 * строке браузера, как раньше.
 */
export class WebPushDeviceKind1891000000000 implements MigrationInterface {
  name = 'WebPushDeviceKind1891000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "web_push_subscriptions"
        ADD COLUMN IF NOT EXISTS "device_kind" varchar(16) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "web_push_subscriptions" DROP COLUMN IF EXISTS "device_kind"
    `);
  }
}
