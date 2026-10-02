import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Напоминания о назначениях: что человеку уже сказано, как часто напоминать
 * и можно ли дослать письмом.
 *
 * assignment_notices — отметки «сказано»: по одной на человека и на его часть
 * или обязанность. По ним первое слово о назначении звучит как «Вам
 * назначено», а не как напоминание; по ним же человеку говорят, что
 * назначение сняли. В строке лежит то, чем назначение называлось и на какой
 * день приходилось, — чтобы об отмене можно было сказать и тогда, когда самой
 * части уже нет.
 *
 * users.reminder_ladder — выбор самого человека: все ступени или только за
 * неделю и накануне. Пусто значит «все».
 *
 * notification_outbox.email_fallback — это уведомление, если отправить его
 * некуда, уходит письмом.
 */
export class AssignmentReminders1890000000000 implements MigrationInterface {
  name = 'AssignmentReminders1890000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assignment_notices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "item_type" varchar(8) NOT NULL,
        "item_id" uuid NOT NULL,
        "meeting_date" date NOT NULL,
        "meeting_kind" varchar(8) NOT NULL,
        "label_key" varchar(64) NOT NULL,
        "label_title" text,
        "assistant" boolean NOT NULL DEFAULT false,
        "slot" integer,
        "told_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_assignment_notices" PRIMARY KEY ("id"),
        CONSTRAINT "uq_assignment_notices_user_item"
          UNIQUE ("user_id", "item_type", "item_id"),
        CONSTRAINT "fk_assignment_notices_congregation"
          FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_assignment_notices_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_assignment_notices_cong_date"
        ON "assignment_notices" ("congregation_id", "meeting_date")
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "reminder_ladder" varchar(8) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_outbox"
        ADD COLUMN IF NOT EXISTS "email_fallback" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification_outbox" DROP COLUMN IF EXISTS "email_fallback"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "reminder_ladder"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "assignment_notices"`);
  }
}
