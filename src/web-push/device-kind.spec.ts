import { webDeviceKind } from './device-kind';

describe('which device a browser subscription is on', () => {
  const ua = (userAgent: string, deviceKind: string | null = null) =>
    webDeviceKind({ userAgent, deviceKind });

  it('reads an iPhone and Android from the user agent', () => {
    expect(
      ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari'),
    ).toBe('ios');
    expect(ua('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe(
      'ios',
    );
    expect(ua('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome Mobile')).toBe(
      'android',
    );
  });

  it('anything else is a computer', () => {
    expect(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome')).toBe(
      'desktop',
    );
    expect(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari')).toBe(
      'desktop',
    );
    expect(webDeviceKind({ userAgent: null })).toBe('desktop');
    expect(webDeviceKind({})).toBe('desktop');
  });

  // An iPad calls itself a Mac: what the device said outranks the string.
  it('believes the device over the user agent', () => {
    expect(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'ios')).toBe(
      'ios',
    );
    expect(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'desktop')).toBe(
      'desktop',
    );
  });

  it('a word it does not know is no word at all', () => {
    expect(ua('Mozilla/5.0 (Linux; Android 15)', 'toaster')).toBe('android');
  });
});
