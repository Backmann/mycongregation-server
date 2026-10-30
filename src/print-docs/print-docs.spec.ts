import {
  PrintDocsService,
  PRINT_DOC_PER_USER,
  PRINT_DOC_TTL_MS,
} from './print-docs.service';
import { PrintDocsController, printPage } from './print-docs.controller';

/** A response that remembers what it was told. */
function fakeRes() {
  const r = {
    headers: {} as Record<string, string>,
    code: 0,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    status(c: number) {
      this.code = c;
      return this;
    },
    send(b: string) {
      this.body = b;
    },
  };
  return r;
}

describe('print-docs — a sheet handed to Safari for ten minutes', () => {
  it('keeps a sheet under a long random token, readable until it expires', () => {
    const s = new PrintDocsService();
    const t0 = 1_000_000;
    const token = s.create('u1', '<html><body>S-21</body></html>', t0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.read(token, t0 + PRINT_DOC_TTL_MS - 1)).toContain('S-21');
    expect(s.read(token, t0 + PRINT_DOC_TTL_MS)).toBeNull();
    expect(s.read('x'.repeat(43), t0)).toBeNull();
  });

  it('refuses nothing to print and a sheet far too large', () => {
    const s = new PrintDocsService();
    expect(() => s.create('u1', '   ')).toThrow();
    expect(() => s.create('u1', 'x'.repeat(4 * 1024 * 1024 + 1))).toThrow();
  });

  it('a person keeps at most ten sheets; the oldest goes first', () => {
    const s = new PrintDocsService();
    const first = s.create('u1', '<p>1</p>', 0);
    for (let i = 0; i < PRINT_DOC_PER_USER; i++)
      s.create('u1', `<p>${i}</p>`, 1);
    expect(s.read(first, 2)).toBeNull();
    expect(s.size(2)).toBe(PRINT_DOC_PER_USER);
  });

  it('serves the sheet in a sandbox: no origin, no cookies, only its own nonce script', () => {
    const s = new PrintDocsService();
    const c = new PrintDocsController(s);
    const { token } = c.create(
      { id: 'u1' } as never,
      '<html><head></head><body><p>S-21</p><script>steal()</script></body></html>',
    );
    const res = fakeRes();
    c.read(token, res as never);

    expect(res.code).toBe(200);
    const csp = res.headers['content-security-policy'];
    // Sandboxed WITHOUT allow-same-origin: an opaque origin, no cookies, no API.
    expect(csp).toMatch(/^sandbox allow-modals allow-scripts;/);
    expect(csp).not.toContain('allow-same-origin');
    // Only the nonce'd script runs: the sheet's own <script> is not allowed.
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
    expect(res.body).toContain(`<script nonce="${nonce}">`);
    expect(csp).not.toContain("unsafe-inline'; script");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('<p>S-21</p>');
    expect(res.body).toContain('window.print()');
  });

  it('an unknown or expired link says so, and serves nothing of anyone', () => {
    const c = new PrintDocsController(new PrintDocsService());
    const res = fakeRes();
    c.read('A'.repeat(43), res as never);
    expect(res.code).toBe(410);
    expect(res.body).toContain('устарела');
    const bad = fakeRes();
    c.read('../etc/passwd', bad as never);
    expect(bad.code).toBe(410);
  });

  it('wraps a bare fragment into a page', () => {
    const page = printPage('<p>hi</p>', 'n');
    expect(page).toMatch(/^<!DOCTYPE html>/);
    expect(page).toContain('<p>hi</p>');
    expect(page).toContain('pd-print');
  });
});
