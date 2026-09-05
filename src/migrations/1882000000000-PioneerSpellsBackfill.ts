import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The spells the first migration could not create.
 *
 * `PioneerSpells1881000000000` seeded one open spell for every publisher who
 * was pioneering AND had a date to start it from. In the congregation this was
 * written for, eight of ten regular pioneers had neither a date of appointment
 * nor a start of ministry, so eight got nothing — and a migration runs once and
 * never again, so filling those dates in afterwards would have changed nothing
 * by itself.
 *
 * This pass adds a spell for anyone who is pioneering, now has a date, and
 * still has no spell. It touches nothing that already exists: no updates, no
 * deletes, and a publisher with a spell is skipped whatever its shape. Safe to
 * run when there is nothing to do — it inserts zero rows and says so.
 */
export class PioneerSpellsBackfill1882000000000 implements MigrationInterface {
  name = 'PioneerSpellsBackfill1882000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: unknown[] = await queryRunner.query(`
      INSERT INTO "pioneer_spells"
        ("congregation_id", "publisher_id", "pioneer_type", "start_month", "note")
      SELECT
        p."congregation_id",
        p."id",
        p."pioneer_type",
        date_trunc('month', COALESCE(p."pioneer_since", p."ministry_start_date"))::date,
        'Дозаполнено после того, как дату назначения проставили вручную'
      FROM "publishers" p
      WHERE p."pioneer_type" IS NOT NULL
        AND p."pioneer_type" <> 'none'
        AND p."deleted_at" IS NULL
        AND COALESCE(p."pioneer_since", p."ministry_start_date") IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "pioneer_spells" s WHERE s."publisher_id" = p."id"
        )
      RETURNING 1
    `);
    // eslint-disable-next-line no-console
    console.log(
      `[PioneerSpellsBackfill] spells added: ${inserted?.length ?? 0}`,
    );
  }

  public async down(): Promise<void> {
    // Nothing to undo: the rows are indistinguishable from hand-entered ones
    // by the time anybody would want them back, and deleting spells is how
    // history gets lost.
  }
}
