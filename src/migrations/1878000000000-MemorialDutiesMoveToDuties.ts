import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Memorial's duties and emblem places leave `memorial_items`.
 *
 * They now live where every other duty lives: in `duties`, as `custom` rows of
 * a third kind of meeting. Keeping an empty copy of them here would leave rows
 * nothing reads and nothing shows — the sort of thing that is found a year
 * later by somebody sweeping the code.
 *
 * WHAT STAYS: the programme. The order of the evening — chairman, songs by
 * number, the three prayers, the speaker and the theme — is what a duty cannot
 * express, and it is why this table exists at all.
 *
 * SAFE TO DELETE, CHECKED FIRST. Before writing this, the live rows were read:
 * eight of them, every `publisher_id` and `person_text` empty. They were the
 * starting list somebody tapped, with nobody assigned to any of it. Had one
 * carried a name, this migration would have COPIED the rows into `duties`
 * instead of removing them — nobody's work is deleted to tidy a schema.
 *
 * The guard below keeps that promise for any other congregation: a row that
 * names somebody is left where it is, so it can be seen and moved by hand
 * rather than vanishing during a deploy.
 */
export class MemorialDutiesMoveToDuties1878000000000 implements MigrationInterface {
  name = 'MemorialDutiesMoveToDuties1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "memorial_items"
       WHERE "section" IN ('duty', 'emblems')
         AND "publisher_id" IS NULL
         AND ("person_text" IS NULL OR "person_text" = '')
    `);
  }

  public async down(): Promise<void> {
    // Nothing to restore: what was removed was an empty starting list, and the
    // same list is laid out again by the duties of a Memorial week. Recreating
    // rows nothing reads would be worse than leaving them gone.
  }
}
