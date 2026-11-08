import { clientOf, requestBase } from './calendar-feed.service';

describe('the link’s address', () => {
  it('the host the app reached, behind the proxy’s https', () => {
    expect(
      requestBase({
        host: 'api.mycongregation.org',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('https://api.mycongregation.org/api');
  });

  it('https when nothing says otherwise; http only for a local stand', () => {
    expect(requestBase({ host: 'api.example.org' })).toBe(
      'https://api.example.org/api',
    );
    expect(requestBase({ host: 'localhost:3000' })).toBe(
      'http://localhost:3000/api',
    );
  });

  it('a host that is not a plain name is not trusted', () => {
    for (const host of [
      'evil.org/path',
      'a b',
      'host@evil.org',
      '',
      'x.org\r\nSet-Cookie: a',
    ]) {
      expect(requestBase({ host })).toBeNull();
    }
    expect(requestBase({})).toBeNull();
  });

  it('a proxy that sends a list: the first scheme', () => {
    expect(
      requestBase({
        host: 'api.example.org',
        'x-forwarded-proto': 'http, https',
      }),
    ).toBe('http://api.example.org/api');
  });
});

describe('which calendar asked', () => {
  it.each([
    ['Google-Calendar-Importer', 'google'],
    ['iOS/17.4 (21E219) dataaccessd/1.0', 'apple'],
    ['macOS/14.4 (23E214) CalendarAgent/988', 'apple'],
    [
      'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)',
      'outlook',
    ],
    ['curl/8.0', 'other'],
    [undefined, 'other'],
  ])('%s → %s', (ua, want) => {
    expect(clientOf(ua)).toBe(want);
  });
});
