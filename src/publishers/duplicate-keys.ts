/**
 * What makes two cards look like one person (1 November 2026): the same
 * first and last name — case, spaces and ё/е aside, in either order — the
 * same e-mail, or the same phone (its last nine digits, so «0151…» and
 * «+49 151…» meet). Shared by the check while a card is entered and the
 * elders' watcher, so both call the same pairs alike.
 */
export function plain(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Both names, ordered, or '' when either is missing. */
export function nameKey(first?: string | null, last?: string | null): string {
  const a = plain(first);
  const b = plain(last);
  if (!a || !b) return '';
  return [a, b].sort().join('|');
}

export function emailKey(email?: string | null): string {
  return plain(email);
}

/** The last nine digits; '' for anything too short to be a phone. */
export function phoneKey(phone?: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
}

export type AlikeBy = 'name' | 'email' | 'phone';

interface Person {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mobilePhone?: string | null;
}

export function alike(a: Person, b: Person): AlikeBy[] {
  const why: AlikeBy[] = [];
  const na = nameKey(a.firstName, a.lastName);
  if (na && na === nameKey(b.firstName, b.lastName)) why.push('name');
  const ea = emailKey(a.email);
  if (ea && ea === emailKey(b.email)) why.push('email');
  const pa = phoneKey(a.mobilePhone);
  if (pa && pa === phoneKey(b.mobilePhone)) why.push('phone');
  return why;
}
