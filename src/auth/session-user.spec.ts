import type { User } from '../entities/user.entity';
import type { AuthenticatedUser } from './decorators/current-user.decorator';
import { meUser, signInUser } from './session-user';

describe('who the app is told it is', () => {
  const account = {
    id: 'u1',
    email: null,
    loginName: 'weber12',
    role: 'elder',
    congregationId: 'c1',
    canViewPrivateData: true,
    passwordHash: 'secret',
    isOwner: false,
  } as unknown as User;
  const session = {
    id: 'u1',
    email: null,
    role: 'elder',
    congregationId: 'c1',
    isOwner: false,
  } as unknown as AuthenticatedUser;

  it('tells the sign-in name at sign-in', () => {
    expect(signInUser(account).loginName).toBe('weber12');
  });

  it('tells it again when the app is opened the next day', () => {
    expect(meUser(session, account).loginName).toBe('weber12');
  });

  it('says on every start everything it said at sign-in', () => {
    const atSignIn = signInUser(account);
    const onStart = meUser(session, account) as Record<string, unknown>;
    for (const [key, value] of Object.entries(atSignIn)) {
      expect([key, onStart[key]]).toEqual([key, value]);
    }
  });

  it('says at sign-in which language the account is kept in', () => {
    // A device never told a language takes this one instead of asking.
    expect(
      signInUser({ ...account, uiLanguage: 'de' } as unknown as User),
    ).toHaveProperty('uiLanguage', 'de');
  });

  it('keeps the id of the sign-in to itself', () => {
    const answer = meUser({ ...session, sessionFamilyId: 'f1' }, account);
    expect(answer).not.toHaveProperty('sessionFamilyId');
  });

  it('gives the capability and never the owner flag or the password', () => {
    const owner = meUser({ ...session, isOwner: true }, account);
    expect(owner.canManageBackups).toBe(true);
    for (const answer of [owner, signInUser(account)]) {
      expect(answer).not.toHaveProperty('isOwner');
      expect(answer).not.toHaveProperty('passwordHash');
    }
    expect(meUser(session, account).canManageBackups).toBe(false);
  });

  it('has no name to tell when none was set', () => {
    const nameless = { ...account, loginName: null } as unknown as User;
    expect(meUser(session, nameless).loginName).toBeNull();
  });
});
