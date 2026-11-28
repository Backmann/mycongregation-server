/**
 * What TypeORM does with a null or an undefined value in a `where`.
 *
 * TypeORM 1.x (28 November 2026): such a call throws — in a find and in an
 * update or a delete alike. That is the rule here, always. Under 0.3 it was
 * switchable (WHERE_INVALID_VALUES, steps 3–4 of the upgrade, R-14); in 1.x
 * there is no «as 0.3» to switch back to — its `ignore` would drop the
 * property from an update or a delete too, and widen them to every row the
 * rest allows. So the variable is still accepted at start (an old .env must
 * not stop the server) and means nothing; the way back is the previous
 * release, not a setting.
 */
export type WhereValuesMode = 'throw';

export function whereValuesMode(): WhereValuesMode {
  return 'throw';
}

export function invalidWhereValuesBehavior(): {
  null: 'throw';
  undefined: 'throw';
} {
  return { null: 'throw', undefined: 'throw' };
}
