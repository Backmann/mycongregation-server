import { readClient } from './read-client';

/**
 * The question behind this is «кто ещё не поставил приложение» — so the kind
 * matters more than the platform, and neither is worth guessing at.
 */
describe('readClient', () => {
  it('recognises the installed app on Android', () => {
    expect(readClient('okhttp/4.9.2 Expo/1.0 (Android 14; SM-G991B)')).toEqual({
      platform: 'android',
      kind: 'app',
    });
  });

  it('recognises the installed app on an iPhone', () => {
    // A native iOS client speaks through CFNetwork and calls itself Darwin.
    expect(
      readClient('MyCongregation/1.0 CFNetwork/1494 Darwin/23.4.0'),
    ).toEqual({ platform: 'ios', kind: 'app' });
  });

  it('calls a phone browser a browser', () => {
    expect(
      readClient(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      ),
    ).toEqual({ platform: 'android', kind: 'browser' });
    expect(
      readClient(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ platform: 'ios', kind: 'browser' });
  });

  it('recognises a desk', () => {
    expect(
      readClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'),
    ).toEqual({ platform: 'windows', kind: 'browser' });
    expect(
      readClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605'),
    ).toEqual({ platform: 'mac', kind: 'browser' });
  });

  it('says «other» rather than dressing a guess as a fact', () => {
    expect(readClient(undefined)).toEqual({
      platform: 'other',
      kind: 'browser',
    });
    expect(readClient('curl/8.4.0')).toEqual({
      platform: 'other',
      kind: 'browser',
    });
  });
});
