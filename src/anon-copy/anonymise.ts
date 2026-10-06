import { NameMap, wordsOf, type NameKind } from './names';
import {
  CATALOGUES,
  EVENT_TITLES,
  PLAN,
  type Rule,
  type TablePlan,
} from './plan';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface Leak {
  table: string;
  column: string;
  /** What kind of thing was found — never the thing itself. */
  what: 'name' | 'ciphertext' | 'address' | 'missing' | 'unplanned';
  count: number;
}

export interface AnonCopy {
  tables: Tables;
  leaks: Leak[];
}

const NAME_RULES = new Set<Rule>(['first', 'wife', 'last', 'full']);

function kindOf(rule: Rule, row: Row): NameKind {
  if (rule === 'last' || rule === 'full') return 'last';
  if (rule === 'wife') return 'female';
  return row.gender === 'sister' ? 'female' : 'male';
}

function columnsOf(plan: TablePlan): [string, Rule][] {
  return plan === 'skip' ? [] : Object.entries(plan);
}

const JW = /^https?:\/\/([a-z0-9-]+\.)*jw\.org(\/|$)/i;
const CLOCK = /^\s*\d{1,2}[:.]\d{2}(\s*[-–]\s*\d{1,2}[:.]\d{2})?\s*$/;

/** Stand-ins: one numbering per label, shared by every table that uses it. */
class Labels {
  private readonly seen = new Map<string, Map<string, number>>();
  private readonly spelt = new Map<string, string[]>();

  of(label: string, real: string): string {
    // What the app takes for the same value stays the same value: it compares
    // such texts with the case and the spaces evened out.
    const key = real.trim().replace(/\s+/g, ' ').toLowerCase();
    let scope = this.seen.get(label);
    if (!scope) this.seen.set(label, (scope = new Map<string, number>()));
    let n = scope.get(key);
    if (n === undefined) scope.set(key, (n = scope.size + 1));
    const base = `${label} ${n}`;
    // …and what the database takes for two values stays two: a second
    // spelling of the same thing gets a second spelling of the stand-in.
    const id = `${label}\u0000${key}`;
    let forms = this.spelt.get(id);
    if (!forms) this.spelt.set(id, (forms = []));
    let at = forms.indexOf(real);
    if (at < 0) at = forms.push(real) - 1;
    if (at === 0) return base;
    if (at === 1) return base.toLowerCase();
    if (at === 2) return base.toUpperCase();
    return base + ' '.repeat(at - 2);
  }
}

interface RevertLike {
  op?: unknown;
  id?: unknown;
  kind?: unknown;
  field?: unknown;
  prev?: unknown;
}

const SPEAKER_KEEP = [
  'publisherId',
  'visitingSpeakerId',
  'publicTalkId',
  'specialTalk',
];

class Copier {
  readonly names = new NameMap();
  private readonly labels = new Labels();
  private emails = 0;
  private logins = 0;

  private text(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  /** A slot's field as the visit's undo plan remembers it. */
  private slotField(field: string, value: unknown): unknown {
    const s = this.text(value);
    if (field === 'speakerName')
      return s === null ? null : this.names.rename(s);
    if (field === 'partTitle') return s === null ? null : this.names.scrub(s);
    if (field === 'speakerCongregation') {
      return s === null ? null : this.labels.of('Собрание', s);
    }
    if (field === 'partDurationMin') {
      return typeof value === 'number' ? value : null;
    }
    return null;
  }

  private revert(value: unknown): unknown {
    if (!Array.isArray(value)) return null;
    const out: unknown[] = [];
    for (const raw of value as RevertLike[]) {
      if (raw === null || typeof raw !== 'object') continue;
      const { op, id } = raw;
      if (op === 'added' || op === 'deleted') out.push({ op, id });
      else if (op === 'meeting') out.push({ op, kind: raw.kind });
      else if (op === 'status') out.push({ op, id, prev: raw.prev });
      else if (op === 'field' && typeof raw.field === 'string') {
        out.push({
          op,
          id,
          field: raw.field,
          prev: this.slotField(raw.field, raw.prev),
        });
      } else if (op === 'speaker') {
        const prev = (raw.prev ?? {}) as Record<string, unknown>;
        const kept: Record<string, unknown> = {};
        for (const key of Object.keys(prev)) {
          kept[key] = SPEAKER_KEEP.includes(key)
            ? prev[key]
            : this.slotField(key, prev[key]);
        }
        out.push({ op, id, prev: kept });
      }
      // An op this code does not know is left out, not copied.
    }
    return out;
  }

  private merge(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of [
      'at',
      'byUserId',
      'exchangeIds',
      'assignmentIds',
      'addedTalkNumbers',
      'filled',
      'keepWasAutoCreated',
      'keepBecameOverseer',
    ]) {
      if (key in v) out[key] = v[key];
    }
    return out;
  }

  apply(rule: Rule, value: unknown, row: Row): unknown {
    if (rule === 'copy') return value;
    if (rule === 'null') return null;
    if (rule === 'false') return false;
    if (rule === 'revert') return value === null ? null : this.revert(value);
    if (rule === 'merge') return value === null ? null : this.merge(value);
    const s = this.text(value);
    if (s === null) return null;
    if (NAME_RULES.has(rule)) {
      for (const w of wordsOf(s)) this.names.learn(w, kindOf(rule, row));
      return this.names.rename(s);
    }
    if (rule === 'scrub') return this.names.scrub(s);
    if (rule === 'url') return JW.test(s) ? s : null;
    if (rule === 'time') return CLOCK.test(s) ? s : null;
    if (rule === 'email') return `u${++this.emails}@example.invalid`;
    if (rule === 'login') return `user${++this.logins}`;
    if (rule === 'eventTitle') {
      const type = typeof row.type === 'string' ? row.type : '';
      return EVENT_TITLES[type] ?? 'Событие';
    }
    if (rule.startsWith('label:')) return this.labels.of(rule.slice(6), s);
    throw new Error(`anon-copy: no such rule «${String(rule)}»`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

/**
 * Rules whose result is, or is made from, the text that was there. The others
 * write words of their own, and a brother's name typed as «…, собрание Юг»
 * must not make every «Собрание 3» look like a leak.
 */
function passesText(rule: Rule): boolean {
  return !(
    rule.startsWith('label:') ||
    rule === 'eventTitle' ||
    rule === 'email' ||
    rule === 'login'
  );
}

/** Every string inside a value, however deep. */
function strings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      strings(v, into);
    }
  }
}

/**
 * Read the finished copy against the real names, as a stranger would.
 *
 * The rules above are what keeps a name out; this is what proves they did.
 * It knows nothing of the rules: it takes the copy and the list of real name
 * words and looks for one inside the other. A field wrongly marked «copy» in
 * the plan is caught here, on the real data, before a file exists.
 */
export function findLeaks(
  copy: Tables,
  real: Map<string, NameKind>,
  plan: Record<string, TablePlan> = PLAN,
): Leak[] {
  const leaks = new Map<string, Leak>();
  const add = (table: string, column: string, what: Leak['what']) => {
    const key = `${table}.${column}.${what}`;
    const was = leaks.get(key);
    if (was) was.count++;
    else leaks.set(key, { table, column, what, count: 1 });
  };
  for (const [table, rows] of Object.entries(copy)) {
    const tablePlan = plan[table];
    if (tablePlan === undefined || tablePlan === 'skip') {
      add(table, '*', 'unplanned');
      continue;
    }
    for (const row of rows) {
      for (const column of Object.keys(tablePlan)) {
        if (!(column in row)) add(table, column, 'missing');
      }
      for (const [column, value] of Object.entries(row)) {
        const rule = tablePlan[column];
        if (rule === undefined) {
          add(table, column, 'unplanned');
          continue;
        }
        const found: string[] = [];
        strings(value, found);
        for (const s of found) {
          if (s.includes('enc:v1:')) add(table, column, 'ciphertext');
          if (/@(?!example\.invalid\b)/.test(s)) add(table, column, 'address');
          if (CATALOGUES.has(table) || UUID.test(s) || STAMP.test(s)) continue;
          // A stand-in is made of this code's own words («Собрание 3»); a
          // real name can only be where real text was let through.
          if (!passesText(rule)) continue;
          for (const w of s.match(/\p{L}+/gu) ?? []) {
            const kind = real.get(w.toLowerCase());
            if (kind === undefined) continue;
            if (rule === 'scrub') {
              // Publication titles are full of first names; a surname
              // written as a name is what must not be there.
              if (kind !== 'last' || w[0] === w[0].toLowerCase()) continue;
            }
            add(table, column, 'name');
          }
        }
      }
    }
  }
  return [...leaks.values()];
}

/**
 * Make the copy. Pure: rows in, rows out — the database is read and the file
 * written elsewhere (cli.ts), so that this can be proved on invented data.
 */
export function anonymise(
  source: Tables,
  plan: Record<string, TablePlan> = PLAN,
): AnonCopy {
  const copier = new Copier();

  // Every real word of every name, before the first invented one is chosen.
  const realWords: string[] = [];
  for (const [table, rows] of Object.entries(source)) {
    for (const [column, rule] of columnsOf(plan[table] ?? 'skip')) {
      if (!NAME_RULES.has(rule)) continue;
      for (const row of rows) {
        const v = row[column];
        if (typeof v === 'string') realWords.push(...wordsOf(v));
      }
    }
  }
  copier.names.forbid(realWords);

  // First the fields that say what a word is — a first name of a sister, a
  // surname — and only then the whole names, where a word says nothing of
  // itself and would be taken for a surname.
  for (const pass of [['first', 'wife'], ['last']] as Rule[][]) {
    for (const [table, rows] of Object.entries(source)) {
      for (const [column, rule] of columnsOf(plan[table] ?? 'skip')) {
        if (!pass.includes(rule)) continue;
        for (const row of rows) copier.apply(rule, row[column], row);
      }
    }
  }

  const tables: Tables = {};
  for (const [table, rows] of Object.entries(source)) {
    const tablePlan = plan[table] ?? 'skip';
    if (tablePlan === 'skip') continue;
    tables[table] = rows.map((row) => {
      const out: Row = {};
      for (const [column, rule] of Object.entries(tablePlan)) {
        out[column] = copier.apply(rule, row[column] ?? null, row);
      }
      return out;
    });
  }

  return { tables, leaks: findLeaks(tables, copier.names.learned(), plan) };
}
