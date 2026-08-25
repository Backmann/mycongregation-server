import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The server must not ask the SERVER what day it is.
 *
 * `new Date().toISOString().slice(0, 10)` reads as "today" and is not: it is
 * today in UTC. For a German congregation in summer that is still yesterday
 * between midnight and 02:00. Thirteen copies of it had accumulated across the
 * code — three of them WRITING that date into the database rather than merely
 * showing it: the month an auxiliary-pioneer period was closed in, the month a
 * period was stopped in, and which meeting-settings version got edited in
 * place.
 *
 * They accumulated the same way the six copies of `berlinToday()` did before
 * `CongregationClock` was written to replace them: nobody adds the thirteenth
 * on purpose, they add the first one in a new file and it looks fine. A
 * comment saying "use the clock" is only read by someone already looking.
 * This test looks every time.
 *
 * The rule is about the DATE, not about `new Date()`. Taking the current
 * moment is ordinary and stays allowed; turning that moment into a calendar
 * day is the step that needs the congregation's timezone, and that is what
 * `CongregationClock.todayFor()` — or `todayIn()` when the timezone is already
 * in hand — is for.
 */

const SRC = join(__dirname, '..');

/** Cutting a calendar day out of a UTC timestamp, however it is spelled. */
const UTC_TODAY =
  /new Date\((?:\s*Date\.now\(\)\s*)?\)\s*\.toISOString\(\)\s*\.(?:slice|substring|substr)\(\s*0\s*,\s*(?:7|10)\s*\)/;

/** The same thing spelled with split('T'). */
const UTC_TODAY_SPLIT =
  /new Date\((?:\s*Date\.now\(\)\s*)?\)\s*\.toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/;

/**
 * This file quotes the pattern in order to forbid it, and the clock's own unit
 * test compares against a UTC date on purpose. Nothing else is exempt — in
 * particular, specs are NOT exempt: a test that builds its expectation from a
 * UTC date will pass in Germany in winter and fail in summer, which is worse
 * than no test.
 */
const EXEMPT = new Set([
  'common/congregation-clock.no-utc-today.spec.ts',
  'common/congregation-clock.spec.ts',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'migrations') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('no UTC "today" anywhere in the server', () => {
  it('every calendar day comes from the congregation clock', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (EXEMPT.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (UTC_TODAY.test(line) || UTC_TODAY_SPLIT.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }

    if (offenders.length > 0) {
      // Thrown rather than asserted, because a bare array diff would not say
      // what to do about it. `expect()` in Jest takes no message argument.
      throw new Error(
        'A calendar day is being cut out of a UTC timestamp. Ask the ' +
          'congregation clock instead — CongregationClock.todayFor(tenantId), ' +
          'or todayIn(now, timezone) when the timezone is already loaded:\n  ' +
          offenders.join('\n  '),
      );
    }
    expect(offenders).toEqual([]);
  });
});
