import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Nothing sends a letter except the handful of places that are supposed to.
 *
 * This exists because of a complaint that could not be answered by reading:
 * «I open the publisher's card and a letter goes out before I press
 * anything.» Reading found no such path — every send sits behind a POST — but
 * «I looked and did not find it» is a weaker statement than a test that fails
 * the moment somebody adds a send somewhere new.
 *
 * The guard is deliberately dumb: it finds every call to the mail service in
 * the source, works out which method it lives in, and refuses any method not
 * named below. Adding a legitimate one means adding a line here — which is the
 * point. A send that appears in a method whose name nobody chose deliberately
 * is exactly the accident this catches.
 */
describe('who is allowed to send a letter', () => {
  /** Methods that may put a letter in the post, and why they are allowed to. */
  const ALLOWED = new Set([
    // Issues an invitation: this IS the letter.
    'sendInvitation',
    // Creating a login with no password invites it — otherwise the account is
    // born unenterable.
    'createUserByAdmin',
    // An elder set somebody's password; the owner hears it from us.
    'resetPasswordByAdmin',
    // A mailbox that has just started serving two logins.
    'noticeMailboxNowShared',
    // «Забыли пароль», asked for by the person themselves.
    'forgotPassword',
  ]);

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });

  it('is only the methods named here', () => {
    const offenders: string[] = [];

    for (const file of walk(join(__dirname, '..'))) {
      // The mail module itself is the postbox, not a caller.
      if (file.includes(`${join('src', 'mail')}`) || file.includes('/mail/')) {
        continue;
      }
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/this\.mailService\.send/.test(line)) return;
        // Walk back to the nearest method declaration.
        let owner = '(top level)';
        for (let j = i; j >= 0; j--) {
          const m =
            /^\s{2}(?:private |public |protected )?(?:async )?([a-zA-Z0-9_]+)\s*\(/.exec(
              lines[j],
            );
          if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'catch') {
            owner = m[1];
            break;
          }
        }
        if (!ALLOWED.has(owner)) {
          offenders.push(`${file}:${i + 1} — inside ${owner}()`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
