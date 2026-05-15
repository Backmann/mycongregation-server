import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogs1781000000000 implements MigrationInterface {
  name = 'AddAuditLogs1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "entity_type" varchar(64) NOT NULL,
        "entity_id" uuid NOT NULL,
        "action" varchar(32) NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "before_json" text,
        "after_json" text,
        "changed_fields" text[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_entity_lookup"
        ON "audit_logs" ("congregation_id", "entity_type", "entity_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_logs_actor"
        ON "audit_logs" ("congregation_id", "actor_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_actor"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_logs_entity_lookup"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
