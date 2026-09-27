import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Как идёт встреча собрания в день события — три ответа вместо двух.
 *
 * Был один переключатель «В этот день обычной встречи нет»: да или нет. Но
 * визит представителя филиала обычно встречу НЕ отменяет — она идёт, только
 * иначе: другое время, другой зал, речь представителя вместо публичной.
 * Сказать это приложению было нечем, и собрание узнавало об изменениях с
 * объявления.
 *
 * Теперь у события три ответа:
 *   - `usual`   — как обычно: время, место и программа прежние;
 *   - `changed` — идёт с изменениями: что меняется (словами), время, место;
 *   - `none`    — встречи нет, событие встаёт на её место.
 *
 * `replaces_meeting` остаётся и держится равным «none»: его читают правила
 * недели на сервере и в приложении, посещаемость и обязанности, и менять их
 * всех ради переименования незачем.
 *
 * Три ответа только у событий без собственного правила — визит представителя
 * филиала и «Другое». Конгресс, Вечеря и визит районного решают встречу сами.
 */
export class EventMeetingMode1887000000000 implements MigrationInterface {
  name = 'EventMeetingMode1887000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "special_events"
        ADD COLUMN IF NOT EXISTS "meeting_mode" varchar(10) NOT NULL DEFAULT 'usual',
        ADD COLUMN IF NOT EXISTS "meeting_note" text,
        ADD COLUMN IF NOT EXISTS "meeting_time" varchar(5),
        ADD COLUMN IF NOT EXISTS "meeting_address" text
    `);
    await queryRunner.query(`
      UPDATE "special_events" SET "meeting_mode" = 'none'
      WHERE "replaces_meeting" = true
        AND COALESCE("type", '') NOT IN
          ('regional_convention', 'circuit_assembly', 'memorial', 'circuit_overseer_visit')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "special_events"
        DROP COLUMN IF EXISTS "meeting_address",
        DROP COLUMN IF EXISTS "meeting_time",
        DROP COLUMN IF EXISTS "meeting_note",
        DROP COLUMN IF EXISTS "meeting_mode"
    `);
  }
}
