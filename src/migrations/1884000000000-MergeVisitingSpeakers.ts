import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Объединение двойников в справочнике приезжих — со следом.
 *
 * Один и тот же брат заводится дважды, когда его имя пишут по-разному:
 * «Иван Ротарюк» и «Rotariuk Iwan» — для приложения два человека, и его
 * история делится надвое ровно там, где она нужна: при решении, кого звать.
 *
 * Объединённая карточка НЕ удаляется бесследно. Она помечается ссылкой на
 * оставшуюся: если через месяц окажется, что это были разные братья,
 * разъединять будет по чему. Решение Лионеля от 7 сентября — после того, как
 * необратимая замена стоила потерянной недели.
 */
export class MergeVisitingSpeakers1884000000000 implements MigrationInterface {
  name = 'MergeVisitingSpeakers1884000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
      ADD COLUMN IF NOT EXISTS "merged_into_id" uuid
    `);
    // SET NULL, а не CASCADE: если оставшуюся карточку когда-нибудь удалят,
    // объединённая должна остаться читаемой, а не исчезнуть следом.
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
      ADD CONSTRAINT "FK_visiting_speakers_merged_into"
      FOREIGN KEY ("merged_into_id")
      REFERENCES "visiting_speakers"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_visiting_speakers_merged_into"
      ON "visiting_speakers" ("merged_into_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_visiting_speakers_merged_into"
    `);
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
      DROP CONSTRAINT IF EXISTS "FK_visiting_speakers_merged_into"
    `);
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers" DROP COLUMN IF EXISTS "merged_into_id"
    `);
  }
}
