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

/**
 * How long an invitation code lives — thirty days, not the three of a
 * password-reset link.
 *
 * They were the same number for one reason only: they were issued together.
 * But they are answers to different situations. A reset link is asked for by
 * somebody standing at the sign-in screen right now, and a short life is what
 * keeps a stray letter from being a way in. An invitation is not asked for at
 * all — it arrives, and it is read whenever it is read. Of the first eleven
 * people invited here, five opened the letter after the fourth day and found a
 * code that no longer worked, no password, and nothing on any screen to do
 * about it.
 *
 * What thirty days costs: a letter sitting in a mailbox stays usable for a
 * month. What it buys: the invitation still works on the evening somebody
 * finally sits down with their phone. Guessing is not the risk being traded
 * here — eight characters from an alphabet of 32 is 32^8, and the attempt
 * limit runs out long before the possibilities do.
 */
export const INVITE_CODE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long the sign-in LINK in the same letter lives. Unchanged: it signs its
 * clicker straight in, which is exactly what must not sit around for a month.
 */
export const INVITE_LINK_LIFETIME_MS = 72 * 60 * 60 * 1000;

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
