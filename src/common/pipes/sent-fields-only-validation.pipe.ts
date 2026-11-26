import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import type { RefusalCode } from '../errors/refusal';

/**
 * The ordinary ValidationPipe, minus the keys the request never sent.
 *
 * A DTO declares its fields as class properties, so an instance carries EVERY
 * one of them — the eighteen a special event has, say — even when the PATCH
 * body held a single time. The extra seventeen arrive as `undefined`, and a
 * service doing the usual `Object.assign(entity, dto)` then overwrites the
 * whole entity with nothing.
 *
 * The database survived that, because TypeORM leaves `undefined` out of the
 * UPDATE. Two other things did not:
 *
 *  - the JOURNAL recorded every untouched field as cleared, which is how «…
 *    изменил · Особые события» came to claim that the title, the kind,
 *    the date and the end date had all been emptied. Nothing of the sort had
 *    happened; the record was simply false, and a record that lies about what
 *    people did is worse than no record;
 *  - the response echoed a half-empty object back to the app.
 *
 * Stripping the unset keys here fixes both at their source, in the one place
 * every request already passes through — rather than in each of the eight
 * services that assign a DTO onto an entity, where the ninth would be written
 * without it. Nothing in the codebase distinguishes "key absent" from "key
 * present and undefined", so nothing else changes.
 */
@Injectable()
export class SentFieldsOnlyValidationPipe extends ValidationPipe {
  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    const result = await super.transform(value, metadata);
    // A yes/no of a JSON body is a JSON yes/no. Implicit conversion turned
    // the text "false" into `Boolean("false")` — true — and @IsBoolean() then
    // saw a boolean and let it pass: «off» sent as text switched a thing ON
    // (found 26 November 2026 by the independent check of the templates).
    // The query string is not here: there yes/no is text, read by queryBool.
    if (metadata.type === 'body') {
      const bad = textMadeBoolean(value, result, '');
      if (bad.length) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_FIELD' satisfies RefusalCode,
          message: bad.map((f) => `${f} must be a boolean value`),
          fields: bad.map((field) => ({ field, rules: ['isBoolean'] })),
        });
      }
    }
    if (
      result === null ||
      typeof result !== 'object' ||
      Array.isArray(result)
    ) {
      return result;
    }
    for (const key of Object.keys(result)) {
      if ((result as Record<string, unknown>)[key] === undefined) {
        delete (result as Record<string, unknown>)[key];
      }
    }
    return result;
  }
}

/**
 * The fields whose value became true or false only by conversion — the sender
 * wrote text or a number — walking nested objects and lists as the DTO does.
 */
export function textMadeBoolean(
  sent: unknown,
  got: unknown,
  path: string,
): string[] {
  if (typeof got === 'boolean') {
    return sent === undefined || sent === null || typeof sent === 'boolean'
      ? []
      : [path];
  }
  if (got === null || typeof got !== 'object' || got instanceof Date) return [];
  if (sent === null || typeof sent !== 'object') return [];
  const out: string[] = [];
  for (const key of Object.keys(got)) {
    // Written as the other refusals write it: «parts.1.done».
    const at = path ? `${path}.${key}` : key;
    out.push(
      ...textMadeBoolean(
        (sent as Record<string, unknown>)[key],
        (got as Record<string, unknown>)[key],
        at,
      ),
    );
  }
  return out;
}
