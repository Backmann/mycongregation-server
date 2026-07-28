import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A field-service meeting learns whose it is, and whether the service overseer
 * came.
 *
 * Meetings here are sometimes for one group and sometimes for the whole
 * congregation, but the record could not say which — so a group could not be
 * shown its own outings, and nothing could answer the question the service
 * overseer actually has to answer: which groups has he not visited this
 * service year.
 *
 * The visit is a mark on the meeting rather than a record of its own. He
 * conducts the meeting and preaches with the group on one occasion; two
 * records about one occasion drift apart, and then nobody knows which date is
 * the true one.
 *
 * Everything is nullable and defaulted, so existing meetings stay exactly as
 * they are: no meeting suddenly belongs to a group, and none claims a visit.
 */
export class FieldServiceMeetingGroupAndVisit1854000000000 implements MigrationInterface {
  name = 'FieldServiceMeetingGroupAndVisit1854000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "field_service_meetings"
        ADD COLUMN "service_group_id" uuid NULL,
        ADD COLUMN "service_overseer_visit" boolean NOT NULL DEFAULT false,
        ADD COLUMN "service_overseer_publisher_id" uuid NULL,
        ADD COLUMN "service_overseer_assistant_id" uuid NULL
    `);

    // Disbanding a group must not delete its meetings, so the link is cleared
    // rather than followed.
    await queryRunner.query(`
      ALTER TABLE "field_service_meetings"
        ADD CONSTRAINT "fk_fsm_service_group"
        FOREIGN KEY ("service_group_id") REFERENCES "service_groups"("id")
        ON DELETE SET NULL
    `);

    // A meeting is either everyone's or one group's. Both at once would leave
    // it belonging to all and to nobody, and every count built on it would be
    // arguable.
    await queryRunner.query(`
      ALTER TABLE "field_service_meetings"
        ADD CONSTRAINT "chk_fsm_general_xor_group"
        CHECK (NOT ("is_general" AND "service_group_id" IS NOT NULL))
    `);

    // A visit is to a GROUP. Marking one on a meeting that belongs to nobody
    // would credit the visit to no one, and the yearly answer would quietly
    // stop adding up.
    await queryRunner.query(`
      ALTER TABLE "field_service_meetings"
        ADD CONSTRAINT "chk_fsm_visit_needs_group"
        CHECK (NOT ("service_overseer_visit" AND "service_group_id" IS NULL))
    `);

    // The question asked of this table is always "this group, this service
    // year", so that is what the index answers. A meeting is keyed by its WEEK
    // plus a day of the week — there is no date column — so the week is what
    // the index carries, and the exact day is worked out where it is needed.
    await queryRunner.query(`
      CREATE INDEX "idx_fsm_group_visit"
        ON "field_service_meetings" ("congregation_id", "service_group_id", "week_start_date")
        WHERE "service_overseer_visit"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_fsm_group_visit"`);
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT IF EXISTS "chk_fsm_visit_needs_group"`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT IF EXISTS "chk_fsm_general_xor_group"`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT IF EXISTS "fk_fsm_service_group"`,
    );
    await queryRunner.query(`
      ALTER TABLE "field_service_meetings"
        DROP COLUMN "service_overseer_assistant_id",
        DROP COLUMN "service_overseer_publisher_id",
        DROP COLUMN "service_overseer_visit",
        DROP COLUMN "service_group_id"
    `);
  }
}
