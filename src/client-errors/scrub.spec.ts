import { fingerprintOf, routePattern, scrub } from './scrub';

describe('a failure report carries nothing that names a person', () => {
  it('mail, ids, phone numbers and tokens become placeholders', () => {
    const out = scrub(
      'Failed for lena.klein@example.org card 1a12bb63-6341-44da-a39f-c2db4d3d5c71 tel +49 151 4189 5755 token eyJhbGciOiJIUzI1NiIsInR5cCI6',
      300,
    );
    expect(out).toBe('Failed for <mail> card <id> tel <num> token <token>');
  });

  it('is cut to its column', () => {
    expect(scrub('ab '.repeat(200), 300)).toHaveLength(300);
  });

  it('a screen is named by its pattern, never by an id or a date', () => {
    expect(
      routePattern('/publishers/1a12bb63-6341-44da-a39f-c2db4d3d5c71?tab=2'),
    ).toBe('/publishers/[id]');
    expect(routePattern('/schedule/edit?week=2026-11-09&meeting=midweek')).toBe(
      '/schedule/edit',
    );
    expect(routePattern('/reports/2026-10')).toBe('/reports/[id]');
  });

  it('the same failure in another build is the same failure', () => {
    const a = {
      platform: 'web',
      route: '/schedule',
      source: 'screen',
      message: 'Cannot read properties of undefined (reading 12)',
      stack: 'at Row (entry-4f3a9.js:1:20301)',
    };
    const b = {
      ...a,
      message: 'Cannot read properties of undefined (reading 13)',
      stack: 'at Row (entry-77b1c.js:1:20999)',
    };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    expect(fingerprintOf({ ...a, route: '/home' })).not.toBe(fingerprintOf(a));
  });
});
