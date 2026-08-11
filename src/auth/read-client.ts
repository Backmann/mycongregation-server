/**
 * What a request came from — asked of the client, not guessed from its agent.
 *
 * THE FIRST VERSION READ THE USER-AGENT ONLY, and on a real phone that produced
 * «неизвестно»: a React Native app signs its requests `okhttp/4.x` and says
 * nothing about the platform it runs on. Browsers describe themselves honestly;
 * our own app was the single client telling the server nothing at all. Guessing
 * harder would not have helped — the fact simply was not in the string.
 *
 * So the app now states it, in one header, and the user-agent stays as the
 * fallback for browsers and for older builds that do not send it yet.
 *
 *   X-Client: platform=android; kind=app; os=14; app=1.1.0
 *
 * WHAT IS NEVER READ, header or not: device model, IP address, browser build.
 * A platform, an OS version, our own build number and a date — enough to manage
 * access and to know who needs help updating, and nothing beyond that.
 */

export type ClientPlatform = 'android' | 'ios' | 'windows' | 'mac' | 'other';
export type ClientKind = 'app' | 'browser';

export interface ClientInfo {
  platform: ClientPlatform;
  kind: ClientKind;
  /** OS version as the client states it, or null when it did not. */
  os: string | null;
  /** Which build of our app, or null in a browser. */
  appVersion: string | null;
}

const PLATFORMS = new Set(['android', 'ios', 'windows', 'mac', 'other']);

/** `a=1; b=2` → a map, forgiving of spacing and of anything unexpected. */
function parseHeader(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) continue;
    out[key.trim().toLowerCase()] = rest.join('=').trim();
  }
  return out;
}

/** Keep a stated version short and plain — «14», «17.4», «1.1.0». */
function tidyVersion(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().slice(0, 20);
  return /^[0-9][0-9.]*$/.test(cleaned) ? cleaned : null;
}

export function readClient(
  userAgent: string | undefined,
  clientHeader?: string | string[] | undefined,
): ClientInfo {
  const stated = Array.isArray(clientHeader) ? clientHeader[0] : clientHeader;
  if (stated) {
    const fields = parseHeader(stated);
    const platform = (fields.platform ?? '').toLowerCase();
    if (PLATFORMS.has(platform)) {
      return {
        platform: platform as ClientPlatform,
        kind: fields.kind === 'browser' ? 'browser' : 'app',
        os: tidyVersion(fields.os),
        appVersion: tidyVersion(fields.app),
      };
    }
  }

  // No header: a browser, or one of our older builds. The agent is honest
  // about browsers, which is exactly the case this still covers.
  const ua = (userAgent ?? '').toLowerCase();

  const kind: ClientKind =
    ua.includes('expo') || ua.includes('okhttp') || ua.includes('cfnetwork')
      ? 'app'
      : 'browser';

  let platform: ClientPlatform = 'other';
  if (ua.includes('android')) platform = 'android';
  else if (/iphone|ipad|ipod|cfnetwork|darwin/.test(ua)) platform = 'ios';
  else if (ua.includes('windows')) platform = 'windows';
  else if (ua.includes('macintosh') || ua.includes('mac os')) platform = 'mac';

  // A Mac agent on a native client is a phone talking through CFNetwork, not
  // somebody at a desk.
  if (kind === 'app' && platform === 'mac') platform = 'ios';

  // A browser states its platform in the agent; the version there is the
  // BROWSER's, not the system's, so it is left out rather than misreported.
  return { platform, kind, os: null, appVersion: null };
}

/** The header's name, shared so the app and the server cannot drift apart. */
export const CLIENT_HEADER = 'x-client';
