import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  loginNameFrom,
  loginNameFromEmail,
  settleLoginName,
} from '../users/login-name';

/**
 * A name to sign in with — and an address that is finally allowed to repeat.
 *
 * Two changes that only make sense together. The name takes over the job of
 * saying who somebody is; the address is released from it, so a family can
 * share a mailbox and a person with no address at all can still be given a
 * login (that second half arrives with the next patch, which stops requiring
 * one).
 *
 * The unique index is PARTIAL — deleted rows are outside it. A unique key that
 * counts deleted rows locks the value away for ever: exactly how one publisher
 * lost July, when a soft-deleted report held the month and every screen showed
 * it free.
 */
export class LoginName1871000000000 implements MigrationInterface {
  name = 'LoginName1871000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_name" character varying(64)`,
    );

    // Everyone who already signs in gets a name, generated the same way new
    // accounts will get theirs: from the publisher card when there is one,
    // from the address when there is not. Oldest first, so that the person who
    // has been here longest keeps the plain form and the newcomer takes the
    // digit — the opposite would rename nobody, but it would surprise the
    // wrong person.
    const rows = (await queryRunner.query(
      `SELECT u.id, u.email, p.first_name, p.last_name
         FROM "users" u
         LEFT JOIN "publishers" p ON p.user_id = u.id AND p.deleted_at IS NULL
        WHERE u.deleted_at IS NULL AND u.login_name IS NULL
        ORDER BY u.created_at ASC`,
    )) as {
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
    }[];

    const taken = new Set<string>();
    for (const row of rows) {
      const fromCard = loginNameFrom(row.last_name, row.first_name);
      const preferred =
        fromCard !== '' ? fromCard : loginNameFromEmail(row.email);
      const settled = await settleLoginName(preferred, (candidate) =>
        taken.has(candidate),
      );
      taken.add(settled);
      await queryRunner.query(
        `UPDATE "users" SET "login_name" = $1 WHERE "id" = $2`,
        [settled, row.id],
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_login_name"
         ON "users" (LOWER("login_name")) WHERE "deleted_at" IS NULL`,
    );

    // The address stops being an identity. The constraint name is the one the
    // very first migration generated; IF EXISTS keeps this safe on a database
    // where it was already dropped by hand.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    // Losing the constraint loses its index, and the login lookup reads
    // LOWER(email) on every attempt.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_email_lower" ON "users" (LOWER("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email_lower"`);
    // Restoring uniqueness can fail where duplicates have since been created —
    // and that is right: it says out loud that going back would need a choice
    // about which account keeps the address.
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_login_name"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "login_name"`,
    );
  }
}
