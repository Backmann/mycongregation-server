import { createHash, randomInt } from 'crypto';

/**
 * An alphabet with no confusable pair in it at all.
 *
 * Not I, not l, not 1; not O, not 0. The usual trick is to accept them and map
 * one onto the other, but then the reader still has to be forgiven for a
 * mistake we invited. Leaving every ambiguous character OUT means the mistake
 * cannot be made: nothing on the screen looks like anything else, so nothing
 * needs correcting.
 *
 * 32 characters, 8 of them: about a thousand billion combinations, against a
 * million for the six digits people usually reach for. That matters, because
 * what this opens is somebody's account.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Five wrong guesses and the code is spent. */
export const INVITE_MAX_ATTEMPTS = 5;

export function makeInviteCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Shown as K7QM-3XPD: two halves are easier to copy off a screen than eight. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Accepts what was actually typed: any case, with or without the hyphen, and
 * with whatever spacing a mail client carried across. Nothing here forgives a
 * WRONG character — the alphabet already made those impossible to read wrongly.
 */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
