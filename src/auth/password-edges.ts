import * as bcrypt from 'bcrypt';

/**
 * The spaces around a password are never part of it.
 *
 * Found on 7 October 2026, with a sister who could not get in after an elder
 * had set her password for her. Two things, mirror images of each other, and
 * neither can be seen on any screen:
 *
 *   • A phone's keyboard adds a space after a word picked from its
 *     suggestions. Typed into the sign-in form, the right password with a
 *     space after it was refused as wrong.
 *   • A password copied from a note and pasted into «Задать пароль» brings
 *     its trailing space or line break along. The rule that judges a
 *     password trimmed it before judging — and the hash was made from the
 *     untrimmed text. So what was stored was a password nobody had seen.
 *
 * The address has been cleaned on its way in since August; the password was
 * not. Now: what is STORED never has spaces around it (cleanPassword, at
 * every place a password is set), and what is TYPED is tried as typed and,
 * failing that, without the spaces around it (passwordMatches, at every
 * place one is checked). A space INSIDE a password is the person's own and
 * is left alone.
 *
 * Every hash and every comparison of a password in this codebase goes
 * through this file — password-edges.spec.ts reads the sources and fails if
 * one does not.
 */
export function cleanPassword(password: string): string {
  return password.trim();
}

/** Hash a password for storing — without the spaces around it. */
export function hashPassword(
  password: string,
  rounds: number,
): Promise<string> {
  return bcrypt.hash(cleanPassword(password), rounds);
}

/**
 * Is this what the person's password is?
 *
 * As typed first: a password set before 7 October may have been stored with
 * a space around it, and whoever knows it that way must still get in.
 */
export async function passwordMatches(
  typed: string,
  hash: string,
): Promise<boolean> {
  if (await bcrypt.compare(typed, hash)) return true;
  const clean = cleanPassword(typed);
  return clean !== typed && (await bcrypt.compare(clean, hash));
}
