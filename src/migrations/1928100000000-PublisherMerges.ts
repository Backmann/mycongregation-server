import { MigrationInterface, QueryRunner } from 'typeorm';

/** Merging two publisher cards, and undoing it for thirty days (1 November 2026). */
export class PublisherMerges1928100000000 implements MigrationInterface {
  name = 'PublisherMerges1928100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "publisher_merges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "kept_id" uuid NOT NULL,
        "merged_id" uuid NOT NULL,
        "by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "undone_at" timestamptz,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "payload" text,
        CONSTRAINT "pk_publisher_merges" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "ix_publisher_merges_kept" ON "publisher_merges" ("congregation_id", "kept_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_publisher_merges_merged" ON "publisher_merges" ("congregation_id", "merged_id")`,
    );
    // «These two are different people» — so the watcher does not ask again.
    await queryRunner.query(`
      CREATE TABLE "publisher_distinct_pairs" (
        "congregation_id" uuid NOT NULL REFERENCES "congregations"("id") ON DELETE CASCADE,
        "a_id" uuid NOT NULL REFERENCES "publishers"("id") ON DELETE CASCADE,
        "b_id" uuid NOT NULL REFERENCES "publishers"("id") ON DELETE CASCADE,
        "by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_publisher_distinct_pairs" PRIMARY KEY ("a_id", "b_id"),
        CONSTRAINT "ck_publisher_distinct_pairs_order" CHECK ("a_id" < "b_id")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "publisher_distinct_pairs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "publisher_merges"`);
  }
}
