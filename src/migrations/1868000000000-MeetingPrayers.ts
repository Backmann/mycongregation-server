import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who prays at the opening and at the close.
 *
 * Named early, when the shape of a meeting was first discussed, and then lost
 * as the agenda itself grew — the items, the outcomes and the approving took
 * all the room and these two never got built. They belong on the meeting
 * beside the one who keeps the record: three brothers named before it starts,
 * so nobody is asked at the door.
 */
export class MeetingPrayers1868000000000 implements MigrationInterface {
  name = 'MeetingPrayers1868000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meetings"
        ADD COLUMN "opening_prayer_publisher_id" uuid NULL
          REFERENCES "publishers"("id") ON DELETE SET NULL,
        ADD COLUMN "closing_prayer_publisher_id" uuid NULL
          REFERENCES "publishers"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "elders_meetings"
        DROP COLUMN "closing_prayer_publisher_id",
        DROP COLUMN "opening_prayer_publisher_id"
    `);
  }
}
