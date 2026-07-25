import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every refresh session a family: one device's sign-in and every session
 * rotated out of it share a familyId.
 *
 * Until now the sessions of a chain had nothing linking them — each rotation
 * created a fresh row and revoked the old one, so the only handle available
 * when a token looked stolen was "every session this user has". That signed a
 * person out of all their devices over a suspicion attached to one of them.
 * With a family the answer can be proportionate: end that chain, leave the
 * rest alone.
 *
 * Existing rows become their own family, which is the truthful reading — we
 * cannot reconstruct chains that were never recorded, and treating each old
 * session as a family of one is the narrowest assumption available.
 */
export class AddRefreshSessionFamily1850000000000 implements MigrationInterface {
  name = 'AddRefreshSessionFamily1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions"
        ADD COLUMN IF NOT EXISTS "family_id" uuid
    `);
    await queryRunner.query(`
      UPDATE "refresh_sessions" SET "family_id" = "id" WHERE "family_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions" ALTER COLUMN "family_id" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_sessions_family_id"
        ON "refresh_sessions" ("family_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_refresh_sessions_family_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_sessions" DROP COLUMN IF EXISTS "family_id"
    `);
  }
}
