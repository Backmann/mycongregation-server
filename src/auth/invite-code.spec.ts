import {
  makeInviteCode,
  formatInviteCode,
  normalizeInviteCode,
  hashInviteCode,
  INVITE_MAX_ATTEMPTS,
} from './invite-code';

/**
 * The code is a key to somebody's account, so the tests are about the two
 * things that make it one: it cannot be read wrongly, and it cannot be
 * guessed. The forgiving parser is tested against what a reader ACTUALLY does
 * — copies it with the hyphen, types it in lower case, leaves a space from the
 * mail client — because every one of those, refused, looks like «the code does
 * not work».
 */
describe('invite code', () => {
  it('never contains a character that looks like another', () => {
    for (let i = 0; i < 500; i++) {
      // I/l/1 and O/0 are absent by construction, not corrected afterwards.
      expect(makeInviteCode()).not.toMatch(/[IOL01]/);
    }
  });

  it('is eight characters long', () => {
    expect(makeInviteCode()).toHaveLength(8);
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(makeInviteCode());
    expect(seen.size).toBe(500);
  });

  it('reads back whatever shape the reader typed', () => {
    const code = makeInviteCode();
    const shown = formatInviteCode(code);
    expect(shown).toContain('-');
    for (const typed of [
      shown,
      code.toLowerCase(),
      '  ' + shown + '  ',
      code.split('').join(' '),
      shown.toLowerCase(),
    ]) {
      expect(normalizeInviteCode(typed)).toBe(code);
    }
  });

  it('hashes, and stores nothing that could be sent back out', () => {
    const code = makeInviteCode();
    const hash = hashInviteCode(code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(code);
    expect(hashInviteCode(code)).toBe(hash);
  });

  it('allows five attempts', () => {
    expect(INVITE_MAX_ATTEMPTS).toBe(5);
  });
});
