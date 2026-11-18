import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether the circuit overseer's wife comes on THIS visit (18 November 2026).
 *
 * Until now the only sign was her name, and the name field said «optional —
 * if he is married»: an empty field meant «not married» and «not filled in»
 * alike, and nothing at all was checked against it. A week laid out from the
 * last visit carried the previous wife's outings into the week of an overseer
 * who comes alone. What matters for the week is whether she comes, so that
 * is now what the visit says; her name stays optional.
 *
 * Existing visits are read by the old sign: a name written down means she
 * comes. Old rows in old shapes keep their meaning.
 */
export class CoWifeComes1934000000000 implements MigrationInterface {
  name = 'CoWifeComes1934000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "special_events"
        ADD COLUMN IF NOT EXISTS "co_wife_comes" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "special_events"
         SET "co_wife_comes" = true
       WHERE "type" = 'circuit_overseer_visit'
         AND coalesce(btrim("co_wife_name"), '') <> ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN IF EXISTS "co_wife_comes"`,
    );
  }
}
