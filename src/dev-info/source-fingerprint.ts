import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * A fingerprint of the server's source (26 September).
 *
 * The SAME computation as app/scripts/code-fingerprint.mjs — the walkthrough
 * works it out from the files on disk and compares it with the one this
 * process took when it started. Different means the process is running older
 * code than the files: `nest start --watch` did not restart (a compile error
 * keeps the old process alive) or the server was started some other way.
 *
 * Paths sorted, with «/»; CRLF made LF in text files (no zero byte in the
 * first 8000, as git decides); tests left out, they never reach the process.
 * Keep in step with the script — both are checked against one fixture.
 */
const skip = (rel: string) =>
  /\.spec\.ts$/.test(rel) || /(^|\/)__tests__\//.test(rel);

function walk(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) out.push(relative(root, full).split(sep).join('/'));
  }
}

function normalized(buf: Buffer): Buffer {
  if (buf.subarray(0, 8000).includes(0)) return buf;
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}

/** Null when there is no src/ beside the process (production runs dist only). */
export function sourceFingerprint(root: string): string | null {
  if (!existsSync(join(root, 'src'))) return null;
  const files: string[] = [];
  walk(root, join(root, 'src'), files);
  const total = createHash('sha256');
  for (const rel of files.filter((f) => !skip(f)).sort()) {
    const h = createHash('sha256')
      .update(normalized(readFileSync(join(root, rel))))
      .digest('hex')
      .slice(0, 16);
    total.update(rel).update('\0').update(h).update('\0');
  }
  return total.digest('hex').slice(0, 12);
}
