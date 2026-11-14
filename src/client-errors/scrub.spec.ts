import { fingerprintOf, isForeign, routePattern, scrub } from './scrub';

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

describe('a failure of code the app never runs', () => {
  it('a page console, an eval or an extension: foreign', () => {
    // As the server keeps it: scrubbed, on one line.
    expect(
      isForeign('TypeError: ts is not iterable at <anonymous>:1:297'),
    ).toBe(true);
    expect(
      isForeign(
        'TypeError: x at fn (chrome-extension://abcdef/content.js:3:14)',
      ),
    ).toBe(true);
    expect(isForeign('fn@moz-extension://a1b2/inject.js:1:9')).toBe(true);
    expect(isForeign('@debugger eval code:1:5')).toBe(true);
  });

  it("the app's bundle anywhere in the stack: its own", () => {
    expect(
      isForeign(
        'TypeError: x at Card (https://mycongregation.org/_expo/static/js/web/entry-4f3a9.js:2:1234) at <anonymous>:1:2',
      ),
    ).toBe(false);
    expect(
      isForeign('at anonymous (address at index.android.bundle:1:2345)'),
    ).toBe(false);
  });

  it('no place named (a phone, a stack cut short, none): its own', () => {
    expect(isForeign(null)).toBe(false);
    expect(isForeign('TypeError: x at Array.map (<anonymous>) at native')).toBe(
      false,
    );
  });
});
