import {
  loginNameFrom,
  loginNameFromEmail,
  looksLikeEmail,
  settleLoginName,
  transliterate,
  LOGIN_NAME_MAX,
} from './login-name';

describe('a name to sign in with', () => {
  it('writes a Russian surname in letters any keyboard can type', () => {
    expect(loginNameFrom('Сидорова', 'Вера')).toBe('sidorova.vera');
  });

  it('does not lose a German umlaut, it spells it out', () => {
    // Müller must not become «mller» — the person would never guess it.
    expect(loginNameFrom('Müller', 'Jörg')).toBe('mueller.joerg');
    expect(transliterate('Straße')).toBe('strasse');
  });

  it('handles the letters that make transliteration ugly', () => {
    expect(loginNameFrom('Щербакова', 'Юлия')).toBe('scherbakova.yuliya');
  });

  it('drops spaces, hyphens and apostrophes rather than keeping them', () => {
    // Anything that survives has to be dictatable over the phone.
    expect(loginNameFrom("Petrova-O'Brien", 'Anna Maria')).toBe(
      'petrovaobrien.annamaria',
    );
  });

  it('falls back to the address when there is no card behind the account', () => {
    expect(loginNameFromEmail('backmannleo@gmail.com')).toBe('backmannleo');
  });

  it('adds a digit when the name is taken, and keeps trying', async () => {
    const taken = new Set(['sidorova.vera', 'sidorova.vera2']);
    await expect(
      settleLoginName('sidorova.vera', (c) => taken.has(c)),
    ).resolves.toBe('sidorova.vera3');
  });

  it('never returns an empty name', async () => {
    // A card written entirely in characters we drop leaves nothing behind.
    await expect(settleLoginName('', () => false)).resolves.toBe('user');
  });

  it('keeps the digit inside the column when the name is at full length', async () => {
    const long = 'a'.repeat(LOGIN_NAME_MAX);
    const settled = await settleLoginName(long, (c) => c === long);
    expect(settled.length).toBeLessThanOrEqual(LOGIN_NAME_MAX);
    expect(settled.endsWith('2')).toBe(true);
  });

  it('refuses to hand back a duplicate rather than let the index refuse it', async () => {
    // A silent duplicate would surface as a database error nobody can act on.
    await expect(settleLoginName('taken', () => true)).rejects.toThrow(
      /could not settle/,
    );
  });

  it('tells an address from a name by the @, and nothing else', () => {
    expect(looksLikeEmail('vera@gmail.com')).toBe(true);
    expect(looksLikeEmail('sidorova.vera')).toBe(false);
  });
});
