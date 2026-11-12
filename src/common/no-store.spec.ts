import { readFileSync } from 'fs';
import { join } from 'path';
import { noStore } from './no-store';

describe('noStore', () => {
  it('forbids keeping every answer, and lets a route set its own afterwards', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
    };
    let passed = false;
    noStore()({} as never, res as never, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    expect(headers['Cache-Control']).toBe('no-store');
    res.setHeader('Cache-Control', 'private, max-age=60');
    expect(headers['Cache-Control']).toBe('private, max-age=60');
  });

  it('is wired in main.ts before the routes', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const at = main.indexOf('app.use(noStore())');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf('app.listen('));
  });
});
