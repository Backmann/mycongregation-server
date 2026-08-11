import { readClient } from './read-client';

/**
 * The question behind this is «кто ещё не поставил приложение» — so the kind
 * matters more than the platform, and neither is worth guessing at.
 */
describe('readClient', () => {
  it('recognises the installed app on Android', () => {
    // A build old enough to send no header, whose agent happens to name the
    // platform. The version stays null: the agent does not state ours.
    expect(readClient('okhttp/4.9.2 Expo/1.0 (Android 14; SM-G991B)')).toEqual({
      platform: 'android',
      kind: 'app',
      os: null,
      appVersion: null,
    });
  });

  it('recognises the installed app on an iPhone', () => {
    // A native iOS client speaks through CFNetwork and calls itself Darwin.
    expect(
      readClient('MyCongregation/1.0 CFNetwork/1494 Darwin/23.4.0'),
    ).toEqual({ platform: 'ios', kind: 'app', os: null, appVersion: null });
  });

  it('calls a phone browser a browser', () => {
    expect(
      readClient(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      ),
    ).toEqual({
      platform: 'android',
      kind: 'browser',
      os: null,
      appVersion: null,
    });
    expect(
      readClient(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ platform: 'ios', kind: 'browser', os: null, appVersion: null });
  });

  it('recognises a desk', () => {
    expect(
      readClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'),
    ).toEqual({
      platform: 'windows',
      kind: 'browser',
      os: null,
      appVersion: null,
    });
    expect(
      readClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605'),
    ).toEqual({ platform: 'mac', kind: 'browser', os: null, appVersion: null });
  });

  it('believes the app when it states what it is', () => {
    // The whole reason for the header: a React Native app signs its requests
    // `okhttp/4.x` and the platform is simply not in that string. Guessing
    // harder never could have worked.
    expect(
      readClient(
        'okhttp/4.9.2',
        'platform=android; kind=app; os=14; app=1.1.0',
      ),
    ).toEqual({
      platform: 'android',
      kind: 'app',
      os: '14',
      appVersion: '1.1.0',
    });
  });

  it('reads the header whatever the spacing', () => {
    expect(
      readClient('okhttp/4.9.2', 'platform=ios;kind=app;  os=17.4;app=1.1.0'),
    ).toEqual({
      platform: 'ios',
      kind: 'app',
      os: '17.4',
      appVersion: '1.1.0',
    });
  });

  it('ignores a version that is not one', () => {
    // Anything unexpected is dropped rather than stored and shown as fact.
    const c = readClient(
      'okhttp/4.9.2',
      'platform=android; kind=app; os=; app=<script>',
    );
    expect(c.os).toBeNull();
    expect(c.appVersion).toBeNull();
  });

  it('falls back to the agent when the header says nothing usable', () => {
    // Older builds send no header at all, and browsers never will.
    expect(
      readClient(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
        'platform=martian; kind=app',
      ).platform,
    ).toBe('windows');
  });

  it('says «other» rather than dressing a guess as a fact', () => {
    expect(readClient(undefined)).toEqual({
      platform: 'other',
      kind: 'browser',
      os: null,
      appVersion: null,
    });
    expect(readClient('curl/8.4.0')).toEqual({
      platform: 'other',
      kind: 'browser',
      os: null,
      appVersion: null,
    });
  });
});
