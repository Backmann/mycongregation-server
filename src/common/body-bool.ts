/**
 * A yes/no field of a JSON body, kept exactly as sent.
 *
 * The validation pipe converts implicitly (main.ts, enableImplicitConversion)
 * before @IsBoolean() looks: the string "false" became `Boolean("false")` —
 * true, and was accepted (found by the independent check of the templates,
 * 26 November 2026: `{"enabled":"false"}` turned a template ON). Reading the
 * raw value from the plain object leaves "false" a string, which
 * @IsBoolean() then refuses.
 *
 * Use as `@Transform(bodyBool)` with `@IsBoolean()`.
 */
export function bodyBool({
  obj,
  key,
  value,
}: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
}): unknown {
  return obj && key in obj ? obj[key] : value;
}
