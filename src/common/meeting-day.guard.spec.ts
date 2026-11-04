import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Which day and hour a meeting has is asked of the week rules — never worked
 * out from the settings (4 November 2026).
 *
 * The settings say what the congregation INTENDS: Wednesday 19:00, Sunday
 * 10:00. A circuit visit moves the midweek meeting, a convention cancels the
 * week, the Memorial takes one meeting, an event may keep a meeting «with
 * changes» at another hour — and next, a meeting may be moved for one week.
 * `common/week-rules.ts` knows all of that; a copy that reads `midweekDow`
 * itself knows none of it. The week/day audit of 4 November found eight such
 * copies on the server alone, each written for a good local reason.
 *
 * So the fields are counted, file by file. The settings module itself and the
 * rules may read them freely. The copies still waiting to be moved over are
 * listed with the number they have today: that number may only go DOWN, and a
 * file not listed may not start. When a copy is removed, lower its number
 * here (or drop the line) so it cannot come back.
 */

const SRC = join(__dirname, '..');

/** Reading a meeting's day or hour straight off a settings version. */
const SETTINGS_DAY_OR_HOUR =
  /\b(?:midweekDow|weekendDow|midweekTime|weekendTime)\b/g;

/** The visit's day worked out again instead of asking the rules. */
const VISIT_DAY_COPY = /coMidweekDow\s*\?\?\s*2\b/g;

/** Where the fields simply belong. */
const FREE = new Set([
  'common/week-rules.ts',
  'entities/meeting-settings.entity.ts',
  'meeting-settings/dto/upsert-meeting-settings.dto.ts',
  'meeting-settings/meeting-settings.service.ts',
  'meeting-settings/past-impact.ts',
]);

/**
 * Copies still to be replaced by the rules, with today's count. Lower these
 * as they go; never raise them.
 */
const STILL_TO_MOVE: Record<string, number> = {
  // Fallback hour when a gathering arrives without one — the gatherings now
  // always carry it, so this goes with stage 2.
  'cleaning/cleaning-reminders.service.ts': 2,
  // The congregation summary's «где и когда»: the raw settings days.
  'congregation-summary/congregation-summary.service.ts': 12,
  // The visit's midweek day, written out again.
  'special-events/event-messages.ts': 1,
  'special-events/co-visit-template.service.ts': 1,
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'migrations') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('a meeting’s day and hour come from the week rules', () => {
  it('no new copy of the settings day or hour, and the old ones only shrink', () => {
    const problems: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (FREE.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      const count =
        (text.match(SETTINGS_DAY_OR_HOUR) ?? []).length +
        (text.match(VISIT_DAY_COPY) ?? []).length;
      const allowed = STILL_TO_MOVE[rel] ?? 0;
      if (count > allowed) {
        problems.push(`${rel}: ${count} (allowed ${allowed})`);
      }
    }
    if (problems.length > 0) {
      throw new Error(
        'A meeting day or hour is being read off the settings. Ask the ' +
          'week rules instead — WeekRulesService.forWeek(s) → dateOf / ' +
          'timeOf / meetings:\n  ' +
          problems.join('\n  '),
      );
    }
    expect(problems).toEqual([]);
  });

  it('keeps the list honest: a copy that is gone must leave the list', () => {
    const stale: string[] = [];
    for (const [rel, allowed] of Object.entries(STILL_TO_MOVE)) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      const count =
        (text.match(SETTINGS_DAY_OR_HOUR) ?? []).length +
        (text.match(VISIT_DAY_COPY) ?? []).length;
      if (count < allowed)
        stale.push(`${rel}: now ${count}, listed ${allowed}`);
    }
    expect(stale).toEqual([]);
  });
});
