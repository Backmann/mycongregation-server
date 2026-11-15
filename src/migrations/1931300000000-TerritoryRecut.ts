import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The draft of re-cutting the territories (15 November 2026): proposals to
 * cut a large territory into parts or to join small neighbours, looked at by
 * the service committee and applied one by one as the territories come back.
 * Nothing in it touches a territory until it is applied.
 *
 * - `territory_recuts`: one draft per congregation, holding its measure,
 *   the keepers' word «city» or «far» on a territory over the drive time,
 *   and the figures last worked out for every territory (walk, homes,
 *   minutes from the nearest hall) with when.
 * - `territory_recut_proposals`: a cut (lines across one territory, the
 *   numbers of the new parts) or a join (the territories, the number kept);
 *   `base` is each territory's border fingerprint when it was drawn, so a
 *   border moved since is seen; `approved_at` is the committee's decision, cleared
 *   when the proposal changes much afterwards.
 * - `territory_recut_remarks`: «no remarks» or a remark about the border,
 *   one per person and proposal, deleted with the proposal or when it is
 *   applied — the decision is kept, the discussion is not.
 */
export class TerritoryRecut1931300000000 implements MigrationInterface {
  name = 'TerritoryRecut1931300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_recuts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "measure" jsonb NOT NULL,
        "classes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metrics" jsonb,
        "metrics_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_recuts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_territory_recuts_congregation" UNIQUE ("congregation_id"),
        CONSTRAINT "FK_territory_recuts_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_recut_proposals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "recut_id" uuid NOT NULL,
        "kind" character varying(8) NOT NULL,
        "territory_ids" uuid[] NOT NULL,
        "base" jsonb NOT NULL,
        "lines" jsonb,
        "keep" smallint NOT NULL DEFAULT 0,
        "numbers" jsonb,
        "keep_id" uuid,
        "queue" smallint NOT NULL DEFAULT 1,
        "state" character varying(10) NOT NULL DEFAULT 'open',
        "approved_at" timestamptz,
        "reopened_at" timestamptz,
        "applied_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_recut_proposals" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_territory_recut_proposals_kind" CHECK ("kind" IN ('cut', 'merge')),
        CONSTRAINT "CHK_territory_recut_proposals_state" CHECK ("state" IN ('open', 'applied')),
        CONSTRAINT "FK_territory_recut_proposals_recut" FOREIGN KEY ("recut_id")
          REFERENCES "territory_recuts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_recut_proposals_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_territory_recut_proposals_recut" ON "territory_recut_proposals" ("recut_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "territory_recut_remarks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "proposal_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "ok" boolean NOT NULL,
        "text" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_territory_recut_remarks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_territory_recut_remarks_person" UNIQUE ("proposal_id", "user_id"),
        CONSTRAINT "FK_territory_recut_remarks_proposal" FOREIGN KEY ("proposal_id")
          REFERENCES "territory_recut_proposals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_recut_remarks_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_territory_recut_remarks_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_recut_remarks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_recut_proposals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "territory_recuts"`);
  }
}
