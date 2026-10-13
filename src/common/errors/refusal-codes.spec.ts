import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REFUSAL_CODES, validationRefusal } from './refusal';

/**
 * The refusals and their codes (13 October 2026).
 *
 * Read from the source itself, like the app's gates read the app: a code
 * thrown that is not on the list, a code on the list that nothing throws,
 * a refusal without a code in a section already done — each fails here, in
 * CI, before a phone shows an English sentence.
 */

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [p] : [];
  });
}

const FILES = sources(SRC).map((p) => ({
  rel: relative(SRC, p).split('\\').join('/'),
  text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n'),
}));

/** Every refusal thrown, with whether it carries a code. */
const REFUSALS = FILES.flatMap(({ rel, text }) =>
  [
    ...text.matchAll(
      /new (BadRequest|Conflict|Forbidden|NotFound|UnprocessableEntity)Exception\(\s*([\s\S]{0,60})/g,
    ),
  ].map((m) => ({
    rel,
    kind: m[1],
    line: text.slice(0, m.index).split('\n').length,
    coded: m[2].startsWith('{') || m[2].startsWith('refusal('),
    // The words of a plain-string refusal, for the wiring list.
    message: /^'([^']*)'/.exec(m[2])?.[1] ?? m[2],
  })),
);

/**
 * The only refusals allowed without a code: faults of the wiring, never met
 * by a person who is signed in — a request reaching a guard with no user or
 * no congregation attached, a route the platform hides. Everything else a
 * person can meet speaks by code (13 October 2026: all sections done).
 */
const WIRING = new Set([
  'No tenant context',
  'No user context',
  'No role context',
  'Cannot determine schedule section',
  'Not available',
]);

describe('refusal codes', () => {
  it('every code thrown is on the list', () => {
    const thrown = new Set<string>();
    for (const { text } of FILES) {
      for (const m of text.matchAll(
        /(?:code: |refusal\(\s*|refuse\(\s*)'([A-Z][A-Z_]+)'/g,
      )) {
        thrown.add(m[1]);
      }
    }
    const listed = new Set<string>(REFUSAL_CODES);
    expect([...thrown].filter((c) => !listed.has(c))).toEqual([]);
    // …and nothing on the list that no refusal ever carries.
    const all = FILES.map((f) => f.text).join('\n');
    expect(REFUSAL_CODES.filter((c) => !all.includes(`'${c}'`))).toEqual([]);
  });

  it('every refusal a person can meet speaks by code', () => {
    const left = REFUSALS.filter(
      (r) => !r.coded && r.kind !== 'NotFound' && !WIRING.has(r.message),
    ).map((r) => `${r.rel}:${r.line} ${r.message}`);
    expect(left).toEqual([]);
  });

  it('a wrong field is said by its name and the rule it broke', () => {
    const e = validationRefusal([
      {
        property: 'address',
        constraints: {
          maxLength: 'address must be shorter than or equal to 255 characters',
        },
        children: [],
      },
      {
        property: 'slots',
        children: [
          {
            property: '2',
            children: [
              {
                property: 'startTime',
                constraints: {
                  matches: 'startTime must match /^\\d\\d:\\d\\d$/',
                },
                children: [],
              },
            ],
          },
        ],
      },
    ] as any);
    const body = e.getResponse() as Record<string, unknown>;
    expect(e.getStatus()).toBe(400);
    expect(body.code).toBe('INVALID_FIELD');
    expect(body.fields).toEqual([
      { field: 'address', rules: ['maxLength'] },
      { field: 'slots.2.startTime', rules: ['matches'] },
    ]);
    // The English sentences stay, for the apps already on phones.
    expect(body.message).toEqual([
      'address must be shorter than or equal to 255 characters',
      'startTime must match /^\\d\\d:\\d\\d$/',
    ]);
  });
});
