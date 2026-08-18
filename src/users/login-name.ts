/**
 * A name to sign in with, so that an address no longer has to be one.
 *
 * The address was doing two jobs at once: saying WHO somebody is, and saying
 * WHERE to send them a letter. That is why a married couple sharing a mailbox
 * could not both have a login, and why forty-four people with no address of
 * their own could not be given one at all.
 *
 * This module does the first job only. Delivery stays with the address, which
 * is free to be missing, or to belong to somebody else.
 */

/**
 * Cyrillic to Latin. Not a standard — the standards optimise for reversibility,
 * and nobody here will ever transliterate back. What matters is that the reader
 * can say the result out loud over the phone.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Ukrainian and Belarusian letters, which appear in this congregation.
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
};

/**
 * German and other Latin diacritics. Müller must not become `mller`, and the
 * German reading of the umlaut (ue, oe, ae) is the one people here expect on
 * a keyboard that cannot type it.
 */
const LATIN: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  á: 'a',
  à: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  õ: 'o',
  ø: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c',
  ý: 'y',
  ż: 'z',
  ź: 'z',
  ł: 'l',
  ś: 's',
  ć: 'c',
  ń: 'n',
  ą: 'a',
  ę: 'e',
};

/** Longest a login name may be — the column is 64. */
export const LOGIN_NAME_MAX = 64;

/**
 * Everything that is not a plain lowercase letter or digit is dropped, so the
 * result can be dictated, typed on any keyboard, and read back without a
 * single question about what character that was.
 */
export function transliterate(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    const mapped = CYRILLIC[ch] ?? LATIN[ch] ?? ch;
    for (const c of mapped) {
      if (c >= 'a' && c <= 'z') out += c;
      else if (c >= '0' && c <= '9') out += c;
    }
  }
  return out;
}

/**
 * Surname first, then given name: `sidorova.vera`.
 *
 * A congregation list is read by surname, and so an elder reading a name out
 * to somebody finds it where he already looks.
 */
export function loginNameFrom(
  lastName: string | null | undefined,
  firstName: string | null | undefined,
): string {
  const last = transliterate(lastName ?? '');
  const first = transliterate(firstName ?? '');
  const joined = [last, first].filter((p) => p !== '').join('.');
  return joined.slice(0, LOGIN_NAME_MAX);
}

/**
 * The part of an address before the @, for an account with no publisher card
 * behind it — an administrator who is not a publisher of this congregation
 * has none, and we deliberately allow that.
 */
export function loginNameFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? '';
  return transliterate(local).slice(0, LOGIN_NAME_MAX);
}

/**
 * Settle on a name nobody else holds.
 *
 * A digit is added on collision (`sidorova.vera2`) rather than a middle name:
 * not everybody has one, and a rule that works for everybody is worth more
 * than a prettier result for some.
 *
 * `isTaken` is asked, not guessed: the caller knows whether it is looking at a
 * live database or at a list being built inside one migration.
 */
export async function settleLoginName(
  preferred: string,
  isTaken: (candidate: string) => Promise<boolean> | boolean,
): Promise<string> {
  // Nothing survived transliteration — a name written entirely in characters
  // we drop, or an empty card. `user` is not pretty, but it is sayable, and
  // the digit makes it unique.
  const base = preferred === '' ? 'user' : preferred;

  if (!(await isTaken(base))) return base;

  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const candidate =
      base.length + suffix.length > LOGIN_NAME_MAX
        ? base.slice(0, LOGIN_NAME_MAX - suffix.length) + suffix
        : base + suffix;
    if (!(await isTaken(candidate))) return candidate;
  }

  // A thousand people with the same name is not a case worth designing for,
  // but silently returning a duplicate would be: the unique index would refuse
  // the insert with a message nobody could act on.
  throw new Error(`could not settle a login name based on "${base}"`);
}

/**
 * What a person may type into the one field on the login screen.
 *
 * An address is told apart from a name by the @ — no lookup, no guessing, and
 * the answer is the same every time. Nothing else can contain one: the name
 * alphabet has no @ in it at all.
 */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}
