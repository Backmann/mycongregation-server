/**
 * What TypeORM does with a null or an undefined value in a `where`
 * (27 November 2026, step 3 of the TypeORM 1.x plan).
 *
 * TypeORM 0.3 with the option left out:
 *   - find/count/exists skip such a property — `{ id: undefined }` is «any
 *     row», and `{ x: null }` meant as «x IS NULL» silently means «any x»;
 *   - update/delete/softDelete/restore keep it as `x = NULL`, which matches
 *     nothing.
 * TypeORM 1.x throws in both. The switch:
 *
 *   WHERE_INVALID_VALUES=throw — 1.x's rule: such a call fails (a 500);
 *   anything else              — the option is left out: 0.3 exactly.
 *
 * Never `{ ignore, ignore }`: set explicitly, 0.3 drops the property in
 * update and delete too, and a delete with one value missing would match
 * every row the others allow (review, 27.11.2026).
 *
 * The database tests always run with `throw` (test/db/harness.ts), so new
 * code meets the rule the day it is written.
 */
export type WhereValuesMode = 'throw' | 'off';

export function whereValuesMode(
  env: Record<string, string | undefined> = process.env,
): WhereValuesMode {
  return env.WHERE_INVALID_VALUES === 'throw' ? 'throw' : 'off';
}

export function invalidWhereValuesBehavior(
  mode: WhereValuesMode = whereValuesMode(),
): { null: 'throw'; undefined: 'throw' } | undefined {
  return mode === 'throw' ? { null: 'throw', undefined: 'throw' } : undefined;
}
