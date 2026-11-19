import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The school's names, as Lionel put them (19 November 2026, evening):
 * «Школа Священного Служения для помощников собрания» — not «для служебных
 * помощников»; and «Школа Священного Служения» with all three words in
 * capitals, in every case.
 *
 * A stored title is the form's automatic one when it is, letter case aside,
 * a name the kind has had: those take the name of today. Any other title is
 * left as it was typed.
 *
 * Every row changed is kept first in `special_events_title_1937` (id and the
 * title before), and down puts exactly those titles back.
 */
const NAMES: [type: string, now: string, before: string[]][] = [
  [
    'kingdom_ministry_school_elders',
    'Школа Священного Служения для старейшин',
    [
      'Школа Священного Служения для старейшин',
      'Школа царственного служения для старейшин',
    ],
  ],
  [
    'kingdom_ministry_school_servants',
    'Школа Священного Служения для помощников собрания',
    [
      'Школа Священного Служения для помощников собрания',
      'Школа Священного Служения для служебных помощников',
      'Школа царственного служения для служебных помощников',
    ],
  ],
];

export class SchoolNameServants1937000000000 implements MigrationInterface {
  name = 'SchoolNameServants1937000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "special_events_title_1937" (
        "id" uuid PRIMARY KEY,
        "title" text NOT NULL
      )
    `);
    for (const [type, now, before] of NAMES) {
      const lowered = before.map((b) => b.toLowerCase());
      await queryRunner.query(
        `INSERT INTO "special_events_title_1937" ("id", "title")
         SELECT "id", "title" FROM "special_events"
          WHERE "type" = $1
            AND lower(btrim("title")) = ANY($2::text[])
            AND "title" <> $3
         ON CONFLICT ("id") DO NOTHING`,
        [type, lowered, now],
      );
      const [{ count }] = (await queryRunner.query(
        `WITH renamed AS (
           UPDATE "special_events" SET "title" = $3
            WHERE "type" = $1
              AND lower(btrim("title")) = ANY($2::text[])
              AND "title" <> $3
           RETURNING "id"
         )
         SELECT COUNT(*)::int AS count FROM renamed`,
        [type, lowered, now],
      )) as { count: number }[];
      console.log(`      [SchoolNameServants] ${type} renamed: ${count}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "special_events" e SET "title" = b."title"
        FROM "special_events_title_1937" b
       WHERE e."id" = b."id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "special_events_title_1937"`);
  }
}
