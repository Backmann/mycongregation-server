import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No file-pattern matching in the app's own code (26 November 2026).
 *
 * glob and minimatch have known faults that only bite when a pattern or a
 * cancellation comes from a request (CVE-2026-118773, CVE-2026-118764).
 * TypeORM 0.3 carries them, but only for our own fixed patterns at start-up
 * — the entity and migration folders — so the alert was closed as «the
 * vulnerable code is not used». This keeps that true: the app's code may not
 * reach for them, or any other glob matcher, directly.
 */
const MATCHERS =
  /(?:from\s+|require\()\s*['"](glob|minimatch|fast-glob|globby|micromatch|picomatch|tinyglobby)(?:\/[^'"]*)?['"]/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('no file-pattern matching in the app’s own code', () => {
  const root = join(__dirname, '..');
  it('nothing imports a glob matcher', () => {
    const found = sources(root)
      .filter((f) => MATCHERS.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    expect(found).toEqual([]);
  });
  it('the rule itself sees an import', () => {
    expect(MATCHERS.test("import { glob } from 'glob';")).toBe(true);
    expect(MATCHERS.test("const mm = require('minimatch')")).toBe(true);
    expect(MATCHERS.test("import { sync } from 'glob/dist/esm';")).toBe(true);
    expect(MATCHERS.test("import { globalThis } from './globals';")).toBe(
      false,
    );
  });
});
