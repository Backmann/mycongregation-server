import { ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';

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
 *  - the JOURNAL recorded every untouched field as cleared, which is how «Лепп
 *    Шамиль изменил · Особые события» came to claim that the title, the kind,
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
