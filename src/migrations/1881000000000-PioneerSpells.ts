import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spells of permanent pioneer service, and the history the cards already imply.
 *
 * The card holds `pioneer_type` and `pioneer_since`, which answer only «what is
 * he today». Everyone currently pioneering therefore has exactly one spell we
 * already know about: from `pioneer_since` (or, failing that, from the start of
 * his ministry — better a slightly early start than a spell with no beginning),
 * still running. That is seeded here so nothing is lost and nothing has to be
 * re-entered by hand for people who are pioneering now.
 *
 * What CANNOT be recovered is a spell that has already ended: a brother who
 * pioneered from 2019 to 2023 left no record anywhere, and no migration can
 * invent one. Those are entered by hand, which is precisely what the new table
 * makes possible.
 *
 * The card fields stay where they are for now — every reader still uses them,
 * and moving forty call sites is a separate step. This migration only builds
 * the ground they will move onto.
 */
export class PioneerSpells1881000000000 implements MigrationInterface {
  name = 'PioneerSpells1881000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pioneer_spells" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "publisher_id" uuid NOT NULL,
        "pioneer_type" character varying(32) NOT NULL,
        "start_month" date NOT NULL,
        "end_month" date,
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pioneer_spells" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pioneer_spells_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_pioneer_spells_publisher" FOREIGN KEY ("publisher_id")
          REFERENCES "publishers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pioneer_spells_cong_publisher"
        ON "pioneer_spells" ("congregation_id", "publisher_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pioneer_spells_cong_start"
        ON "pioneer_spells" ("congregation_id", "start_month")
    `);

    // Seed one open spell for everyone pioneering right now. date_trunc keeps
    // the first-of-month shape the table compares on.
    const seeded: { count: string }[] = await queryRunner.query(`
      INSERT INTO "pioneer_spells"
        ("congregation_id", "publisher_id", "pioneer_type", "start_month", "note")
      SELECT
        p."congregation_id",
        p."id",
        p."pioneer_type",
        date_trunc('month', COALESCE(p."pioneer_since", p."ministry_start_date"))::date,
        'Перенесено из карточки при появлении истории пионерского служения'
      FROM "publishers" p
      WHERE p."pioneer_type" IS NOT NULL
        AND p."pioneer_type" <> 'none'
        AND p."deleted_at" IS NULL
        AND COALESCE(p."pioneer_since", p."ministry_start_date") IS NOT NULL
      RETURNING 1 AS count
    `);
    // eslint-disable-next-line no-console
    console.log(`[PioneerSpells] seeded from cards: ${seeded?.length ?? 0}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pioneer_spells"`);
  }
}
