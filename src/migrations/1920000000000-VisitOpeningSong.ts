import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The guest's opening song lives on his visit (Lionel, 25 October 2026).
 *
 * The guest chooses the song himself and tells it in advance — often weeks
 * before the week's programme exists. It is kept on the journal entry and
 * written into the programme's opening-song line when that line is there;
 * a song chosen in the programme comes back to the entry the same way.
 *
 * Filled now from the programme: the opening song of each week that has a
 * live incoming entry, so the two say the same from the first day.
 */
export class VisitOpeningSong1920000000000 implements MigrationInterface {
  name = 'VisitOpeningSong1920000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" ADD COLUMN IF NOT EXISTS "opening_song" smallint`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "talk_exchange" ADD CONSTRAINT "CHK_talk_exchange_opening_song"
          CHECK ("opening_song" IS NULL OR "opening_song" BETWEEN 1 AND 999);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      UPDATE talk_exchange t
         SET opening_song = substring(a.part_title from '(?:Песня|Song|Lied)\\s*№?\\s*(\\d{1,3})')::smallint
        FROM assignments a
       WHERE a.congregation_id = t.congregation_id
         AND a.part_key = 'weekend_opening_song'
         AND a.deleted_at IS NULL
         AND a.week_start_date = date_trunc('week', t.date)::date
         AND substring(a.part_title from '(?:Песня|Song|Lied)\\s*№?\\s*(\\d{1,3})') IS NOT NULL
         AND substring(a.part_title from '(?:Песня|Song|Lied)\\s*№?\\s*(\\d{1,3})')::int BETWEEN 1 AND 999
         AND t.direction = 'incoming'
         AND t.deleted_at IS NULL
         AND t.status <> 'did_not_happen'
         AND t.opening_song IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP CONSTRAINT IF EXISTS "CHK_talk_exchange_opening_song"`,
    );
    await queryRunner.query(
      `ALTER TABLE "talk_exchange" DROP COLUMN IF EXISTS "opening_song"`,
    );
  }
}
