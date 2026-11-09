import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two conductors for the meeting with the pioneers, each a card or a name
 * written by hand (Lionel, 9 November 2026). The meetings kept so far keep
 * their one elder in the first place.
 */
export class PioneerMeetingConductors1929000000000 implements MigrationInterface {
  name = 'PioneerMeetingConductors1929000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pioneer_meetings"
        ALTER COLUMN "conductor_publisher_id" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "conductor_name" character varying(120),
        ADD COLUMN IF NOT EXISTS "second_conductor_publisher_id" uuid,
        ADD COLUMN IF NOT EXISTS "second_conductor_name" character varying(120)
    `);
    await queryRunner.query(`
      ALTER TABLE "pioneer_meetings"
        DROP CONSTRAINT IF EXISTS "FK_pioneer_meetings_second_conductor",
        ADD CONSTRAINT "FK_pioneer_meetings_second_conductor"
          FOREIGN KEY ("second_conductor_publisher_id")
          REFERENCES "publishers"("id") ON DELETE RESTRICT,
        DROP CONSTRAINT IF EXISTS "CHK_pioneer_meetings_first_conductor",
        ADD CONSTRAINT "CHK_pioneer_meetings_first_conductor"
          CHECK (("conductor_publisher_id" IS NULL) <> ("conductor_name" IS NULL)),
        DROP CONSTRAINT IF EXISTS "CHK_pioneer_meetings_second_conductor",
        ADD CONSTRAINT "CHK_pioneer_meetings_second_conductor"
          CHECK ("second_conductor_publisher_id" IS NULL OR "second_conductor_name" IS NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The first conductor's column stays nullable: a meeting conducted by
    // a written name has no card to put back, and is not thrown away.
    await queryRunner.query(`
      ALTER TABLE "pioneer_meetings"
        DROP CONSTRAINT IF EXISTS "CHK_pioneer_meetings_second_conductor",
        DROP CONSTRAINT IF EXISTS "CHK_pioneer_meetings_first_conductor",
        DROP CONSTRAINT IF EXISTS "FK_pioneer_meetings_second_conductor",
        DROP COLUMN IF EXISTS "second_conductor_name",
        DROP COLUMN IF EXISTS "second_conductor_publisher_id",
        DROP COLUMN IF EXISTS "conductor_name"
    `);
  }
}
