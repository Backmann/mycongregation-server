/**
 * What a request came from, in the two words worth keeping.
 *
 * A user-agent string says far more than anybody here needs: version numbers,
 * device models, engine builds. All of that is a way of watching people rather
 * than managing access, so it is read once and thrown away, and what remains is
 * a platform and a kind of client.
 *
 * The kind matters most: 'app' means push notifications reach this person and
 * an update has to be installed; 'browser' means neither. That single fact is
 * what an administrator is really asking when he wonders who has the app.
 */

export type ClientPlatform = 'android' | 'ios' | 'windows' | 'mac' | 'other';
export type ClientKind = 'app' | 'browser';

export interface ClientInfo {
  platform: ClientPlatform;
  kind: ClientKind;
}

/**
 * Expo's own agent identifies the installed app; anything else on a phone is
 * that phone's browser. Deliberately forgiving: an unknown agent is 'other' and
 * 'browser', never a guess dressed up as a fact.
 */
export function readClient(userAgent: string | undefined): ClientInfo {
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

  return { platform, kind };
}
