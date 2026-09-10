import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Отсутствие знает, что его создала поездка.
 *
 * Поездка «От нас» заводит отсутствие: брат в этот день у чужого собрания.
 * Ссылка была только в одну сторону — из поездки, — и на экране отсутствие
 * выглядело обычным, заведённым человеком. Брат убирал его, а приложение при
 * следующем сохранении поездки не находило удалённого и заводило новое. Спор,
 * в котором ни один из двоих не видит другого: 8 сентября так вернулись два
 * отсутствия Шейфера.
 *
 * Обратная ссылка это заканчивает: такое отсутствие подписано своей причиной,
 * не удаляется отдельно и снимается вместе с поездкой.
 *
 * Признак для школы пионеров (`pioneer_school_duty_id`) уже существует и решает
 * ровно ту же задачу; здесь сделано так же, чтобы правило в приложении было
 * одно, а не два похожих.
 */
export class AbsenceFromTrip1885000000000 implements MigrationInterface {
  name = 'AbsenceFromTrip1885000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "absences"
      ADD COLUMN IF NOT EXISTS "talk_exchange_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "absences"
      ADD CONSTRAINT "FK_absences_talk_exchange"
      FOREIGN KEY ("talk_exchange_id")
      REFERENCES "talk_exchange"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_absences_talk_exchange"
      ON "absences" ("talk_exchange_id")
    `);

    /**
     * Прошлые отсутствия помечаются здесь же.
     *
     * Опознаются надёжно: поездка хранит номер заведённого ею отсутствия.
     * Решение Лионеля — прошлые тоже важно знать, иначе половина записей
     * осталась бы без причины и вела бы себя по-старому.
     */
    const [{ count }] = (await queryRunner.query(`
      WITH updated AS (
        UPDATE "absences" a
        SET "talk_exchange_id" = t."id"
        FROM "talk_exchange" t
        WHERE t."linked_absence_id" = a."id"
          AND a."talk_exchange_id" IS NULL
        RETURNING a."id"
      )
      SELECT COUNT(*)::int AS count FROM updated
    `)) as { count: number }[];
    console.log(
      `      [AbsenceFromTrip] marked as coming from a trip: ${count}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_absences_talk_exchange"`,
    );
    await queryRunner.query(`
      ALTER TABLE "absences" DROP CONSTRAINT IF EXISTS "FK_absences_talk_exchange"
    `);
    await queryRunner.query(`
      ALTER TABLE "absences" DROP COLUMN IF EXISTS "talk_exchange_id"
    `);
  }
}
