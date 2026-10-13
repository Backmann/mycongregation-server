import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * EVERY code a refusal may carry (13 October 2026).
 *
 * The app shows a refusal in the reader's own language by its CODE: the
 * English `message` stays beside it for the versions of the app already on
 * phones, and for the server's own log, but nobody in a hall should have to
 * read «weekStartDate must be a Monday.». Until now each section that cared
 * kept its own few codes and its own table in the app, and three hundred
 * refusals had none at all.
 *
 * The list lives here, in one place, like the notification types:
 *  - the server's test (refusal-codes.spec.ts) reads the source and fails
 *    when a code is thrown that is not on this list, and counts the refusals
 *    still without a code so that the number can only go down;
 *  - the app's gate (scripts/check-server-refusals.mjs) reads this file and
 *    fails when a code has no words in ru, de and en.
 *
 * One per line, in quotes — the app's gate reads them as text.
 */
export const REFUSAL_CODES = [
  // ---- said by the shared machinery ----
  'INVALID_FIELD',
  'NEEDS_RESPONSIBILITY',
  'NEEDS_ROLE',
  'NO_SUCH_GROUP',
  'NO_SUCH_PUBLISHER',
  'SPAN_INVALID',
  'WEEK_NOT_MONDAY',
  // ---- field-service meetings ----
  'FS_PAST_LOCKED',
  'FS_GENERAL_AND_GROUP',
  'FS_VISIT_NEEDS_GROUP',
  'FS_NOT_A_CONDUCTOR',
  'FS_SLOT_NO_OCCURRENCE',
  'FS_GENERAL_NEEDS_ADDRESS',
  // ---- duties ----
  'DUTIES_PAST_LOCKED',
  'DUTIES_NO_MEMORIAL',
  'DUTIES_MEETING_NOT_HELD',
  'DUTY_ONLY_OWN_RENAME',
  'DUTY_ONLY_OWN_REMOVE',
  // ---- the Memorial ----
  'MEMORIAL_PAST_LOCKED',
  // ---- the circuit overseer's visit ----
  'CO_VISIT_PAST_LOCKED',
  'CO_VISIT_SCHEDULE_CLOSED',
  'CO_VISIT_WEEK_TAKEN',
  // ---- special events ----
  'EVENT_CHANGE_EMPTY',
  'EVENT_END_BEFORE_START',
  'EVENT_LINK_INVALID',
  'EVENT_MEMORIAL_NEEDS_TIME',
  'EVENT_MEMORIAL_TAKEN',
  'EVENT_MOVED_INTO_PAST',
  'EVENT_PAST_ADMIN_ONLY',
  'EVENT_PAST_LOCKED',
  'EVENT_TIME_INVALID',
  'EVENT_TIME_ORDER',
  'EVENT_TYPE_UNKNOWN',
  'EVENT_SPECIAL_TALK_IN_JOURNAL',
  // ---- accounts and signing in ----
  'BAD_EMAIL',
  'BAD_LOGIN_NAME',
  'INVITE_INVALID',
  'LOGIN_NAME_TAKEN',
  'LOGIN_SHARED_EMAIL',
  'RATE_LIMITED',
  'WEAK_PASSWORD',
  'OWNER_PROTECTED',
  'OWN_ROLE',
  'OWN_DEACTIVATION',
  'LAST_ACTIVE_ADMIN',
  // ---- elsewhere, coded before this list existed ----
  'ABSENCE_FROM_TRIP',
  'ALREADY_MERGED',
  'NOT_A_MISSED_VISIT',
  'NOT_MERGED_HERE',
  'NO_MERGE_RECORD',
  'OTHER_GROUP',
  'REPORT_EXISTS',
  'REPORT_EXISTS_ELSEWHERE',
  'SAME_CARD',
  'SAME_SPEAKER',
  'WEEK_ALREADY_PAST',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

/**
 * The body of a refusal: its code, the English sentence as before, and
 * whatever the reader's words need — a date, a list of responsibilities.
 *
 *   throw new ConflictException(refusal('FS_PAST_LOCKED', '…', { date }));
 */
export function refusal(
  code: RefusalCode,
  message: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...params, code, message };
}

/**
 * A field the request got wrong, said by its NAME and the RULE it broke —
 * not by the library's English sentence.
 *
 * The ValidationPipe used to answer «address must be shorter than or equal
 * to 255 characters»; the sentence stays in `message` for older apps, and
 * `fields` says the same thing in a form the app can put into words:
 * `[{ field: 'address', rules: ['maxLength'] }]`. Nested fields keep their
 * path — `slots.2.startTime`.
 */
export function validationRefusal(
  errors: ValidationError[],
): BadRequestException {
  const fields: { field: string; rules: string[] }[] = [];
  const messages: string[] = [];
  const walk = (list: ValidationError[], prefix: string) => {
    for (const e of list) {
      const path = prefix ? `${prefix}.${e.property}` : e.property;
      if (e.constraints) {
        fields.push({ field: path, rules: Object.keys(e.constraints) });
        messages.push(...Object.values(e.constraints));
      }
      if (e.children && e.children.length > 0) walk(e.children, path);
    }
  };
  walk(errors, '');
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'INVALID_FIELD' satisfies RefusalCode,
    message: messages,
    fields,
  });
}
