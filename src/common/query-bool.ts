/**
 * A yes/no flag read from the query string — `?includeRemoved=false`.
 *
 * The validation pipe converts implicitly (main.ts, enableImplicitConversion),
 * and it does so BEFORE a @Transform runs: by the time the transform saw the
 * value, "false" had already become `Boolean("false")` — true. So
 * `?includeRemoved=false` listed the removed groups, and `?isActive=false`
 * meant the active ones (found 28 October 2026: the groups' list showed a
 * removed group with «Показать удалённые» off). The raw text is read from the
 * plain object instead, which the conversion does not touch.
 *
 * Use as `@Transform(queryBool)` with `@IsBoolean()`; anything but true/false
 * reads as absent.
 */
export function queryBool({
  obj,
  key,
  value,
}: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
}): boolean | undefined {
  const raw = obj && key in obj ? obj[key] : value;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return undefined;
}
