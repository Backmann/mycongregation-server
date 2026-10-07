import type { User } from '../entities/user.entity';
import type { AuthenticatedUser } from './decorators/current-user.decorator';

/**
 * Who the app is told it is talking to — at sign-in, and again every time it
 * is opened.
 *
 * These are two answers to one question, and they were written in two places.
 * The name a person signs in with was added to the first (sign-in) and not to
 * the second (`GET /auth/me`, which the app asks on every start). So the
 * profile showed the name right after signing in and, from the next start on,
 * said «Имя входа не задано» to everybody who had one — and advised the
 * administrator to set a name that was already set. Found on a copy of the
 * live data on 6 October: the test accounts had no sign-in names, so there the
 * hint happened to be true.
 *
 * Both answers are built here now, and session-user.spec.ts holds them
 * together: whatever sign-in says about a person, the next start says too.
 */
export function signInUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    // The one thing a person needs to sign in again on another day.
    loginName: user.loginName,
    role: user.role,
    congregationId: user.congregationId,
    canViewPrivateData: user.canViewPrivateData,
    // The language the account is kept in — the one its letters are written
    // in. A device that has never been told a language takes this one, so
    // nobody is asked «выберите язык» before they have seen a single screen.
    uiLanguage: user.uiLanguage,
  };
}

export function meUser(session: AuthenticatedUser, account: User) {
  // A capability, not the flag. The owner marker is deliberately invisible
  // everywhere; what the interface actually needs is whether to show the
  // backups row, and that can be answered without telling anyone that a
  // notion of platform owner exists at all.
  // The chain id is plumbing — it marks «это устройство» on the server and
  // has no business in what the app is told about the person.
  const { isOwner, sessionFamilyId: _chain, ...rest } = session;
  return {
    ...rest,
    loginName: account.loginName,
    canViewPrivateData: account.canViewPrivateData,
    canManageBackups: isOwner === true,
  };
}
