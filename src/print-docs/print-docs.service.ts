import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { refusal } from '../common/errors/refusal';

/**
 * A SHEET TO PRINT, HANDED TO SAFARI FOR TEN MINUTES (30 October 2026).
 *
 * iOS ignores print() altogether in an app opened from the Home Screen, so on
 * an iPhone or iPad no printer button in the app printed anything. Safari
 * prints. The app hands the sheet it has already made to the server, gets a
 * link that works once opened without signing in, and Safari opens it and
 * prints.
 *
 * The sheet lives in this process's memory only — never on disk, never in
 * the database — for ten minutes, and is gone with a restart. The link is 32
 * random bytes. What it serves is put in a sandbox (see the controller): it
 * cannot reach the sign-in or the API, and its own scripts do not run.
 */
export const PRINT_DOC_TTL_MS = 10 * 60 * 1000;
/** A sheet as the app makes it: a few tens of kilobytes; the cap is generous. */
export const PRINT_DOC_MAX_CHARS = 4 * 1024 * 1024;
/** Live sheets per person and overall — the oldest goes first. */
export const PRINT_DOC_PER_USER = 10;
export const PRINT_DOC_TOTAL = 300;

interface PrintDoc {
  html: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class PrintDocsService {
  private readonly docs = new Map<string, PrintDoc>();

  /** Keep a sheet; returns its token. */
  create(userId: string, html: string, now = Date.now()): string {
    if (typeof html !== 'string' || html.trim().length === 0) {
      throw new PayloadTooLargeException(
        refusal('PRINT_DOC_EMPTY', 'There is nothing to print.'),
      );
    }
    if (html.length > PRINT_DOC_MAX_CHARS) {
      throw new PayloadTooLargeException(
        refusal('PRINT_DOC_TOO_LARGE', 'This sheet is too large to print.'),
      );
    }
    this.prune(now);
    // The same person's oldest sheets go first, then anybody's.
    const mine = [...this.docs.entries()].filter(
      ([, d]) => d.userId === userId,
    );
    while (mine.length >= PRINT_DOC_PER_USER) {
      this.docs.delete(mine.shift()![0]);
    }
    while (this.docs.size >= PRINT_DOC_TOTAL) {
      this.docs.delete(this.docs.keys().next().value as string);
    }
    const token = randomBytes(32).toString('base64url');
    this.docs.set(token, { html, userId, expiresAt: now + PRINT_DOC_TTL_MS });
    return token;
  }

  /** The sheet while it lives; null when unknown or expired. */
  read(token: string, now = Date.now()): string | null {
    const doc = this.docs.get(token);
    if (!doc) return null;
    if (doc.expiresAt <= now) {
      this.docs.delete(token);
      return null;
    }
    return doc.html;
  }

  /** How many sheets live now (for tests). */
  size(now = Date.now()): number {
    this.prune(now);
    return this.docs.size;
  }

  private prune(now: number): void {
    for (const [token, doc] of this.docs) {
      if (doc.expiresAt <= now) this.docs.delete(token);
    }
  }
}
