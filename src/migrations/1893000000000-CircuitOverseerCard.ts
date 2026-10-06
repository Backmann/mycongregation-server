import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Районный старейшина в журнале «К нам» (5 октября 2026).
 *
 * Визит районного — тоже приезд докладчика: он выступает с публичной речью,
 * и эта речь должна быть в журнале и в истории. До сих пор она попадала туда
 * случайно — только если кто-то трогал слот речи в программе — и тогда
 * районному заводилась обычная карточка приезжего без собрания: в разделе
 * «Без собрания», в ответе «кто давно не был», в подсказке про двойников.
 *
 * `visiting_speakers.circuit_overseer` отличает такую карточку. История у неё
 * та же, что у любой другой, а списки, по которым решают, кого пригласить,
 * её пропускают: районного не приглашают, он приезжает сам.
 *
 * Заодно помечаются карточки, которые приложение уже успело завести районным
 * раньше: то же имя, что у районного в одном из визитов собрания, и без
 * собрания. Карточку с собранием миграция не трогает — тёзка из соседнего
 * собрания не должен стать районным молча; такую помечают руками.
 */
export class CircuitOverseerCard1893000000000 implements MigrationInterface {
  name = 'CircuitOverseerCard1893000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
        ADD COLUMN IF NOT EXISTS "circuit_overseer" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "visiting_speakers" vs
         SET "circuit_overseer" = true
        FROM "special_events" e
       WHERE e."type" = 'circuit_overseer_visit'
         AND e."congregation_id" = vs."congregation_id"
         AND vs."external_congregation_id" IS NULL
         AND vs."merged_into_id" IS NULL
         AND vs."deleted_at" IS NULL
         AND btrim(coalesce(e."co_first_name", '') || ' ' || coalesce(e."co_last_name", '')) <> ''
         AND lower(regexp_replace(btrim(vs."first_name" || ' ' || coalesce(vs."last_name", '')), '\\s+', ' ', 'g'))
           = lower(regexp_replace(btrim(coalesce(e."co_first_name", '') || ' ' || coalesce(e."co_last_name", '')), '\\s+', ' ', 'g'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers" DROP COLUMN IF EXISTS "circuit_overseer"
    `);
  }
}
