import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Takes back what the journal never had the right to say.
 *
 * Until the request pipeline was fixed, a PATCH carrying one field arrived as
 * a DTO carrying all of them, the rest as `undefined`. `Object.assign` then
 * put those undefineds onto the entity, and the change log — comparing before
 * with after in good faith — recorded every untouched field as cleared. The
 * database itself was never harmed; the record of what people did was.
 *
 * This removes only what is IMPOSSIBLE, and the database decides what that is:
 * a claim that a NOT NULL column became empty describes something the schema
 * would never have permitted. No guessing, no heuristics about what somebody
 * probably meant. Where a column is nullable the claim might be true — a
 * person really can clear a note — so it stays, even though some of those are
 * false too. Better an unremoved falsehood than an invented truth.
 *
 * What survives in every touched row: who, when, and every change that really
 * happened. A row left with nothing provable simply reads «изменил», which is
 * still true — something was saved.
 *
 * Rows are never deleted. This is the congregation's record of its own work.
 */
export class RepairFalseClearedFields1853000000000 implements MigrationInterface {
  name = 'RepairFalseClearedFields1853000000000';

  /** Which table each logged entity type lives in. Unknown types are skipped. */
  private static readonly TABLES: Record<string, string> = {
    absence: 'absences',
    assignment: 'assignments',
    auxiliary_pioneer: 'auxiliary_pioneers',
    cart_location: 'cart_locations',
    circuit_overseer: 'circuit_overseers',
    congregation: 'congregations',
    duty: 'duties',
    external_congregation: 'external_congregations',
    field_service_meeting: 'field_service_meetings',
    hall: 'halls',
    local_need: 'local_needs_topics',
    meeting_attendance: 'meeting_attendance',
    publisher: 'publishers',
    responsibility: 'responsibilities',
    service_group: 'service_groups',
    service_report: 'service_reports',
    special_event: 'special_events',
    talk_exchange: 'talk_exchange',
    user: 'users',
    visiting_speaker: 'visiting_speakers',
  };

  private static toColumn(field: string): string {
    return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same kind of record, two spellings — 'User' and 'user' — so half the
    // entries never matched their section name and showed the raw word.
    await queryRunner.query(
      `UPDATE "audit_logs" SET "entity_type" = lower("entity_type")
         WHERE "entity_type" <> lower("entity_type")`,
    );

    let repaired = 0;
    for (const [entityType, table] of Object.entries(
      RepairFalseClearedFields1853000000000.TABLES,
    )) {
      const notNull: { column_name: string }[] = await queryRunner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = $1
            AND is_nullable = 'NO'`,
        [table],
      );
      if (notNull.length === 0) continue; // no such table here — skip
      const required = new Set(notNull.map((r) => r.column_name));

      const rows: {
        id: string;
        changed_fields: string[] | null;
        before_json: string | null;
        after_json: string | null;
      }[] = await queryRunner.query(
        `SELECT id, changed_fields, before_json, after_json
           FROM "audit_logs"
          WHERE "entity_type" = $1
            AND "action" = 'UPDATE'
            AND "after_json" IS NOT NULL
            AND "redacted_at" IS NULL`,
        [entityType],
      );

      for (const row of rows) {
        let after: Record<string, unknown>;
        let before: Record<string, unknown>;
        try {
          after = JSON.parse(row.after_json ?? '{}') ?? {};
          before = JSON.parse(row.before_json ?? '{}') ?? {};
        } catch {
          continue; // unreadable payload: leave it exactly as it is
        }

        const impossible = (row.changed_fields ?? []).filter(
          (f) =>
            after[f] === null &&
            required.has(RepairFalseClearedFields1853000000000.toColumn(f)),
        );
        if (impossible.length === 0) continue;

        const keptFields = (row.changed_fields ?? []).filter(
          (f) => !impossible.includes(f),
        );
        for (const f of impossible) {
          delete after[f];
          delete before[f];
        }

        await queryRunner.query(
          `UPDATE "audit_logs"
              SET "changed_fields" = $2,
                  "before_json" = $3,
                  "after_json" = $4
            WHERE "id" = $1`,
          [
            row.id,
            keptFields,
            keptFields.length > 0 ? JSON.stringify(before) : null,
            keptFields.length > 0 ? JSON.stringify(after) : null,
          ],
        );
        repaired += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[RepairFalseClearedFields] entries corrected: ${repaired}`);
  }

  public async down(): Promise<void> {
    // Nothing to undo: what was removed was never true, and restoring a
    // falsehood is not a repair.
  }
}
