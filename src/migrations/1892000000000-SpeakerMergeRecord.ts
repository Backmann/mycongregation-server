import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Разъединение двойников и «это разные братья» (5 октября 2026).
 *
 * 1. `visiting_speakers.merge_record` — что именно переехало при объединении.
 *    До сих пор от объединения оставалась одна ссылка «куда»; визиты двух
 *    братьев после него неотличимы, и обещанное «можно будет разобрать» было
 *    невыполнимо. Запись стоит на объединённой карточке. У объединённых раньше
 *    она пуста — их разобрать нельзя, и приложение так и говорит.
 *
 * 2. `visiting_speaker_distinct_pairs` — пары карточек, про которые человек
 *    ответил «это разные братья». Справочник подсказывает вероятных двойников
 *    (то же имя в другом порядке или другим алфавитом); тёзки обычны, и ответ
 *    должен запоминаться для всех, кто ведёт справочник.
 */
export class SpeakerMergeRecord1892000000000 implements MigrationInterface {
  name = 'SpeakerMergeRecord1892000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
        ADD COLUMN IF NOT EXISTS "merge_record" jsonb NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "visiting_speaker_distinct_pairs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "speaker_a_id" uuid NOT NULL,
        "speaker_b_id" uuid NOT NULL,
        "created_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_visiting_speaker_distinct_pairs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vs_distinct_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vs_distinct_a" FOREIGN KEY ("speaker_a_id")
          REFERENCES "visiting_speakers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vs_distinct_b" FOREIGN KEY ("speaker_b_id")
          REFERENCES "visiting_speakers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vs_distinct_pair"
        ON "visiting_speaker_distinct_pairs"
        ("congregation_id", "speaker_a_id", "speaker_b_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vs_distinct_congregation"
        ON "visiting_speaker_distinct_pairs" ("congregation_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "visiting_speaker_distinct_pairs"`,
    );
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers" DROP COLUMN IF EXISTS "merge_record"
    `);
  }
}
