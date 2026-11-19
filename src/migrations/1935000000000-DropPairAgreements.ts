import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Arranging preparation with the partner is gone from the app (19 November
 * 2026): unused since it shipped (no notice sent, no agreement in the live
 * database), and its «не получится» under a part read as refusing the part.
 * The table goes with it. `down` puts it back as it was, empty — its rows
 * lived only until the day after the meeting.
 */
export class DropPairAgreements1935000000000 implements MigrationInterface {
  name = 'DropPairAgreements1935000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "pair_agreements"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pair_agreements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "congregation_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "holder_publisher_id" uuid NOT NULL,
        "assistant_publisher_id" uuid NOT NULL,
        "proposed_by_publisher_id" uuid NOT NULL,
        "option_kind" character varying(16) NOT NULL,
        "option_date" date,
        "option_time" character varying(5),
        "option_meeting" character varying(8),
        "status" character varying(10) NOT NULL,
        "proposed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "answered_at" TIMESTAMP WITH TIME ZONE,
        "meeting_date" date NOT NULL,
        "last_started_on" date NOT NULL,
        "messages_on" date NOT NULL,
        "messages_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pair_agreements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pair_agreements_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pair_agreements_assignment" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pair_agreements_holder" FOREIGN KEY ("holder_publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pair_agreements_assistant" FOREIGN KEY ("assistant_publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pair_agreements_proposed_by" FOREIGN KEY ("proposed_by_publisher_id") REFERENCES "publishers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pair_agreements_assignment" ON "pair_agreements" ("assignment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pair_agreements_meeting_date" ON "pair_agreements" ("meeting_date")`,
    );
  }
}
