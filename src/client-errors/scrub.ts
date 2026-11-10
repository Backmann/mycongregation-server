import { createHash } from 'node:crypto';

/**
 * What a failure report may carry — and nothing that could name a person.
 *
 * The app scrubs before it sends; the server scrubs again, because a report
 * is accepted from anyone and the rule must not depend on a client keeping
 * it. A mail address, a phone number, an id or any long number becomes a
 * placeholder; the text is cut to its column.
 */
export function scrub(text: string, max: number): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<mail>')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<id>',
    )
    .replace(/\+?\d[\d\s/().-]{6,}\d/g, '<num>')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The screen as a pattern: every part of the address that is an id, a date or
 * a number becomes «[id]», and the query string goes — «/schedule/[id]».
 */
export function routePattern(route: string): string {
  const path = route.split(/[?#]/)[0] || '/';
  return (
    path
      .split('/')
      .map((seg) =>
        /^[0-9a-f-]{8,}$/i.test(seg) || /\d/.test(seg) || seg.length > 40
          ? '[id]'
          : seg,
      )
      .join('/')
      .slice(0, 200) || '/'
  );
}

/**
 * Two reports are one failure when they happen on the same screen, of the
 * same kind, with the same words and in the same function — the digits
 * taken out and the file's place dropped, since a minified file's name and a
 * line number change with every build.
 */
export function fingerprintOf(r: {
  platform: string;
  route: string;
  source: string;
  message: string;
  stack: string | null;
}): string {
  // The first frame by its function only: where the file is, and its name
  // with the build's hash in it, change with every build.
  const firstFrame = ((r.stack ?? '').split('\n').find((l) => l.trim()) ?? '')
    .replace(/\(.*\)/g, '')
    .replace(/\S*(https?:|\/)\S*/g, '')
    .trim();
  const norm = (s: string) => s.replace(/\d+/g, '#');
  return createHash('sha256')
    .update(
      [r.platform, r.route, r.source, norm(r.message), norm(firstFrame)].join(
        '|',
      ),
    )
    .digest('hex')
    .slice(0, 64);
}
