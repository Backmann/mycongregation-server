import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A local-needs topic learns WHICH part of the programme it became, and stops
 * pretending to have a manual order.
 *
 * Until now a topic and the meeting part it filled were connected by nothing
 * but a copied string: inserting a topic wrote its title into the part and
 * ticked a week on the topic. Change the part to a different topic, or delete
 * it, and the first topic stayed marked as used for a week where it no longer
 * appeared — history that quietly stopped being true, in the one place the
 * body of elders relies on to avoid repeating a subject.
 *
 * With the part's id on the topic, "used" becomes a fact the app can check and
 * withdraw by itself.
 *
 * `sort_order` goes the other way: it was read by the query that lists topics
 * and written by nothing at all — there has never been a screen that changes
 * it, so every row holds the same zero. A column that looks like a working
 * feature and is not costs the next reader an hour.
 *
 * Both halves are reversible, and no existing topic changes state: the new
 * column starts null, which reads as "used, but we do not know which part" —
 * exactly what is true of every topic marked before today.
 */
export class LocalNeedsBindingAndOrder1856000000000 implements MigrationInterface {
  name = 'LocalNeedsBindingAndOrder1856000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics"
        ADD COLUMN "used_assignment_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_local_needs_used_assignment"
        ON "local_needs_topics" ("used_assignment_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics" DROP COLUMN "sort_order"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics"
        ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_local_needs_used_assignment"
    `);
    await queryRunner.query(`
      ALTER TABLE "local_needs_topics" DROP COLUMN "used_assignment_id"
    `);
  }
}
