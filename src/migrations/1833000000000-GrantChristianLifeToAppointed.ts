import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grant the new `christian_life` capability (conducts a "Living as Christians"
 * part of the midweek meeting) to every elder and ministerial servant in the
 * congregation. Requested as the initial roster; further changes are made by
 * hand in the publisher card.
 */
export class GrantChristianLifeToAppointed1833000000000 implements MigrationInterface {
  name = 'GrantChristianLifeToAppointed1833000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "publishers"
       SET "capabilities" = jsonb_set(
         COALESCE("capabilities", '{}'::jsonb),
         '{christian_life}',
         'true'::jsonb
       )
       WHERE "appointment" IN ('elder', 'ministerial_servant')
         AND "deleted_at" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    // No-op: leave existing grants in place.
  }
}
