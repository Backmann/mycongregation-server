/**
 * Whether a password is fit to protect a congregation's records.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: demand a capital, a digit and a symbol.
 * Rules like that do not produce strong passwords, they produce `Password1!`
 * and a note under the keyboard — the same handful of shapes, chosen by the
 * rule rather than by the person. Length and a check against what attackers
 * already try first are worth more than any amount of punctuation.
 *
 * So: at least ten characters, and none of the passwords the whole world
 * already uses. The list below is short on purpose — the few hundred that
 * appear at the top of every leaked collection, which is where an attacker
 * starts and usually stops. A longer list belongs in a file, and a real
 * check belongs against a breach service; both are worth doing later, and
 * neither is a reason to keep accepting `12345678` today.
 */

/** The shapes an attacker tries first, in lower case. */
const COMMON = new Set([
  '123456789',
  '1234567890',
  '12345678910',
  'password',
  'password1',
  'password123',
  'qwertyuiop',
  'qwerty123',
  'iloveyou',
  'princess',
  'admin123',
  'welcome1',
  'welcome123',
  'letmein123',
  'monkey123',
  'sunshine',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'starwars',
  'whatever',
  'computer',
  'jesus123',
  'jehovah1',
  'jehovah123',
  'watchtower',
  'congregation',
  'пароль123',
  'йцукенгш',
  'ячсмитьбю',
]);

export type PasswordProblem =
  | 'tooShort'
  | 'tooCommon'
  | 'looksLikeEmail'
  | 'tooRepetitive';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * What is wrong with this password, or null when nothing is.
 *
 * `email` is optional and only used to catch the most human of shortcuts:
 * the address itself, or the part before the @, as the password.
 */
export function passwordProblem(
  password: string,
  email?: string,
): PasswordProblem | null {
  const value = password.trim();

  if (value.length < PASSWORD_MIN_LENGTH) return 'tooShort';

  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return 'tooCommon';

  // A run of one character, or a straight walk up the keyboard's numbers:
  // long enough to pass the length rule and worth nothing.
  if (/^(.)\1+$/.test(value)) return 'tooRepetitive';
  if (/^(0123456789|1234567890|9876543210)/.test(value)) return 'tooRepetitive';

  if (email) {
    const address = email.toLowerCase().trim();
    const localPart = address.split('@')[0];
    if (lower === address || (localPart.length >= 4 && lower === localPart)) {
      return 'looksLikeEmail';
    }
  }

  return null;
}
