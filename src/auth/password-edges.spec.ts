import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { cleanPassword, hashPassword, passwordMatches } from './password-edges';

const SECRET = 'Kiefer Regen Lampe';

describe('the spaces around a password are never part of it', () => {
  it('what is stored has no spaces around it — pasted from a note, with its space and its line break', async () => {
    const hash = await hashPassword(`  ${SECRET} \n`, 4);
    expect(await bcrypt.compare(SECRET, hash)).toBe(true);
    expect(await bcrypt.compare(`${SECRET} `, hash)).toBe(false);
  });

  it('a space INSIDE is the person’s own and stays', async () => {
    expect(cleanPassword(` ${SECRET} `)).toBe(SECRET);
    const hash = await hashPassword(SECRET, 4);
    expect(await passwordMatches('KieferRegenLampe', hash)).toBe(false);
  });

  it.each([
    ['as it is', SECRET],
    [
      'with the space a phone keyboard adds after a suggested word',
      `${SECRET} `,
    ],
    ['with a space before', ` ${SECRET}`],
    ['pasted with a line break', `${SECRET}\n`],
  ])('the right password is let in %s', async (_how, typed) => {
    const hash = await hashPassword(SECRET, 4);
    expect(await passwordMatches(typed, hash)).toBe(true);
  });

  it('a wrong password is wrong, with or without spaces', async () => {
    const hash = await hashPassword(SECRET, 4);
    expect(await passwordMatches('Kiefer Regen Lampf', hash)).toBe(false);
    expect(await passwordMatches('Kiefer Regen Lampf ', hash)).toBe(false);
    expect(await passwordMatches('', hash)).toBe(false);
  });

  it('a password stored WITH a space before this rule still lets in whoever types it that way', async () => {
    const old = await bcrypt.hash(`${SECRET} `, 4);
    expect(await passwordMatches(`${SECRET} `, old)).toBe(true);
  });
});

/**
 * The rule holds only if nothing goes round it. A hash made or compared
 * anywhere else would be a password judged by another rule — which is how
 * the stored text and the judged text came to differ in the first place.
 */
describe('every password is hashed and compared in one place', () => {
  const SRC = join(__dirname, '..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };

  it('no source file but password-edges.ts calls bcrypt', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(200);
    const offenders = files
      .filter((f) => !f.endsWith(join('auth', 'password-edges.ts')))
      .filter((f) =>
        /\bbcrypt\s*\.\s*(hash|compare)\w*\s*\(/.test(readFileSync(f, 'utf8')),
      )
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
