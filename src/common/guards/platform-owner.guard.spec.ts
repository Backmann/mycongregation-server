import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformOwnerGuard } from './platform-owner.guard';

const ctx = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

/**
 * The boundary this guard draws is the one the whole security posture rests
 * on, so it is worth pinning: only an owner passes, and nothing about being an
 * administrator — of any congregation — substitutes for it.
 */
describe('PlatformOwnerGuard', () => {
  const guard = new PlatformOwnerGuard();

  it('lets the platform owner through', () => {
    expect(guard.canActivate(ctx({ id: 'u1', isOwner: true }))).toBe(true);
  });

  it('refuses a congregation administrator', () => {
    expect(() => guard.canActivate(ctx({ id: 'u1', role: 'admin' }))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses when the flag is merely absent — absence means no', () => {
    expect(() => guard.canActivate(ctx({ id: 'u1' }))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a falsy flag rather than treating it as set', () => {
    expect(() => guard.canActivate(ctx({ id: 'u1', isOwner: false }))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(ctx({ id: 'u1', isOwner: 'yes' })),
    ).not.toThrow();
  });

  it('refuses when there is no user at all', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('says nothing about owners existing', () => {
    try {
      guard.canActivate(ctx({ id: 'u1' }));
    } catch (e) {
      // Someone probing this endpoint should learn only that it is closed to
      // them, not that a privileged class of account exists.
      expect((e as Error).message).toBe('Not available');
      expect((e as Error).message.toLowerCase()).not.toContain('owner');
    }
  });
});
