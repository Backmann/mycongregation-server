/**
 * WHICH DEVICE a browser subscription lives on.
 *
 * The rule for sending is «one notification a physical device» (decided
 * 3 October 2026), and a subscription does not say what it is on:
 *
 *   - `ios`     an iPhone or an iPad with the app on its Home Screen. It can
 *               never be the Android phone that runs the installed app, so it
 *               is always its own device and always gets the message.
 *   - `android` a browser on an Android phone — very likely THE phone that
 *               also runs the app, where a second copy would be a duplicate.
 *   - `desktop` a computer: often shared at home, and a message read on the
 *               phone has done its work before anybody sits down at it.
 *
 * The device says it itself when it subscribes (`deviceKind`). Rows older
 * than that are read from the user agent, which is right for an iPhone and
 * for Android but NOT for an iPad: iPadOS presents itself as a Mac. Such a
 * row stays `desktop` — what it was treated as before — until the iPad opens
 * the app once and reports what it is.
 */
export const WEB_DEVICE_KINDS = ['ios', 'android', 'desktop'] as const;
export type WebDeviceKind = (typeof WEB_DEVICE_KINDS)[number];

export function webDeviceKind(sub: {
  deviceKind?: string | null;
  userAgent?: string | null;
}): WebDeviceKind {
  const said = sub.deviceKind;
  if (said === 'ios' || said === 'android' || said === 'desktop') return said;
  const ua = sub.userAgent ?? '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}
