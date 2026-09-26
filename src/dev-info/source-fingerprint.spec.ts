import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sourceFingerprint } from './source-fingerprint';

/**
 * The fixture app/scripts/check-code-fingerprint.mjs checks too: the same
 * files must give the same number in the script and in the server, or the
 * walkthrough would call every server stale.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'fp-'));
  mkdirSync(join(root, 'src', 'b', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'x\r\ny\n');
  writeFileSync(join(root, 'src', 'b', 'c.ts'), 'z');
  writeFileSync(join(root, 'src', 'b', 'bin.dat'), Buffer.from([1, 0, 13, 10]));
  writeFileSync(join(root, 'src', 'd.spec.ts'), 'left out');
  writeFileSync(join(root, 'src', 'b', '__tests__', 'e.ts'), 'left out');
  return root;
}

describe('sourceFingerprint', () => {
  it('matches the walkthrough script for the shared fixture', () => {
    expect(sourceFingerprint(fixture())).toBe(FIXTURE_HASH);
  });

  it('reads Windows and Unix line endings as the same file', () => {
    const a = fixture();
    const b = fixture();
    writeFileSync(join(b, 'src', 'a.ts'), 'x\ny\n');
    expect(sourceFingerprint(a)).toBe(sourceFingerprint(b));
  });

  it('changes when a file changes, and ignores tests', () => {
    const a = fixture();
    const before = sourceFingerprint(a);
    writeFileSync(join(a, 'src', 'd.spec.ts'), 'still left out');
    expect(sourceFingerprint(a)).toBe(before);
    writeFileSync(join(a, 'src', 'b', 'c.ts'), 'zz');
    expect(sourceFingerprint(a)).not.toBe(before);
  });

  it('is null without a src folder', () => {
    expect(sourceFingerprint(mkdtempSync(join(tmpdir(), 'fp-')))).toBeNull();
  });
});

const FIXTURE_HASH = '10f81ed39fe1';
