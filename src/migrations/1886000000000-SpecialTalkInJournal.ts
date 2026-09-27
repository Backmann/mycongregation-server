import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Специальная речь живёт там же, где и все речи, — в журнале «К нам / От нас».
 *
 * До сих пор она заводилась СОБЫТИЕМ, а докладчик — в программе и в журнале.
 * Одна и та же речь лежала в двух местах, и ни одно не знало о другом: в
 * журнале строка без темы, в событиях тема без докладчика, а неделя, для
 * которой программы ещё нет, не видна координатору вовсе (так было со
 * специальной речью 14 марта 2027 года).
 *
 * Теперь у записи журнала есть тема специальной речи, а у слота речи в
 * программе — отметка «специальная». Обе существующие речи переезжают:
 *   - неделя с программой: слот получает отметку (тема остаётся), запись
 *     журнала этой недели — ту же тему;
 *   - неделя без записи в журнале: заводится запись без докладчика, с темой —
 *     программа подхватит её, когда неделя появится;
 *   - само событие уходит в корзину: оттуда его можно вернуть.
 *
 * Неделю, где в программе уже стоит речь из каталога, не трогаем: там
 * «специальная» и номер спорят, и решать это должен человек.
 */
/** The rows of a SELECT, typed at the call. */
async function rows<T>(
  queryRunner: QueryRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await queryRunner.query(sql, params)) as T[];
}

export class SpecialTalkInJournal1886000000000 implements MigrationInterface {
  name = 'SpecialTalkInJournal1886000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "talk_exchange"
      ADD COLUMN IF NOT EXISTS "special_theme" text
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD COLUMN IF NOT EXISTS "special_talk" boolean NOT NULL DEFAULT false
    `);

    const events = await rows<{
      id: string;
      congregation_id: string;
      date: string;
      title: string;
      note: string | null;
    }>(
      queryRunner,
      `
      SELECT "id", "congregation_id", to_char("date", 'YYYY-MM-DD') AS "date",
             "title", "note"
      FROM "special_events"
      WHERE "type" = 'special_talk' AND "deleted_at" IS NULL
      ORDER BY "date"
    `,
    );

    for (const e of events) {
      const title = e.title.trim();
      const [{ monday, sunday }] = await rows<{
        monday: string;
        sunday: string;
      }>(
        queryRunner,
        `SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS "monday",
                  to_char(date_trunc('week', $1::date) + interval '6 days', 'YYYY-MM-DD') AS "sunday"`,
        [e.date],
      );

      const slots = await rows<{
        id: string;
        part_title: string | null;
        public_talk_id: string | null;
      }>(
        queryRunner,
        `SELECT "id", "part_title", "public_talk_id" FROM "assignments"
         WHERE "congregation_id" = $1 AND "week_start_date" = $2
           AND "part_key" = 'public_talk_speaker' AND "deleted_at" IS NULL
         LIMIT 1`,
        [e.congregation_id, monday],
      );
      const slot = slots[0];
      if (slot?.public_talk_id) continue;

      const entries = await rows<{ id: string; public_talk_id: string | null }>(
        queryRunner,
        `SELECT "id", "public_talk_id" FROM "talk_exchange"
           WHERE "congregation_id" = $1 AND "direction" = 'incoming'
             AND "date" BETWEEN $2 AND $3 AND "status" <> 'did_not_happen'
             AND "deleted_at" IS NULL
           ORDER BY "date" LIMIT 1`,
        [e.congregation_id, monday, sunday],
      );
      const entry = entries[0];
      if (entry?.public_talk_id) continue;

      // Тема одна на обе стороны: та, что уже стоит в программе, если стоит.
      const theme = slot?.part_title?.trim() || title;

      if (slot) {
        await queryRunner.query(
          `UPDATE "assignments"
           SET "special_talk" = true, "part_title" = $2
           WHERE "id" = $1`,
          [slot.id, theme],
        );
      }

      if (entry) {
        await queryRunner.query(
          `UPDATE "talk_exchange"
           SET "special_theme" = $2, "note" = COALESCE("note", $3)
           WHERE "id" = $1`,
          [entry.id, theme, e.note],
        );
      } else {
        await queryRunner.query(
          `INSERT INTO "talk_exchange"
             ("congregation_id", "direction", "date", "status",
              "special_theme", "note")
           VALUES ($1, 'incoming', $2, 'confirmed', $3, $4)`,
          [e.congregation_id, e.date, theme, e.note],
        );
      }

      await queryRunner.query(
        `UPDATE "special_events" SET "deleted_at" = now() WHERE "id" = $1`,
        [e.id],
      );
    }
  }

  /**
   * Обратно — только столбцы. Событий из корзины не возвращаем: после
   * переезда тему могли поправить в журнале, и возвращённое событие было бы
   * вторым, уже неверным, местом той же речи.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP COLUMN IF EXISTS "special_talk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "special_theme"`,
    );
  }
}
