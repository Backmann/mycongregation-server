import { UserOrIpThrottlerGuard } from './throttler.guard';

/**
 * The whole point of the custom tracker is that a congregation sharing one
 * wifi is not treated as a single caller.
 */
describe('UserOrIpThrottlerGuard — tracker', () => {
  const guard = Object.create(
    UserOrIpThrottlerGuard.prototype,
  ) as UserOrIpThrottlerGuard;

  const track = (req: Record<string, unknown>) =>
    (
      guard as unknown as {
        getTracker: (r: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(req);

  it('keys an authenticated request by account', async () => {
    await expect(
      track({ user: { id: 'user-1' }, ip: '203.0.113.7' }),
    ).resolves.toBe('user:user-1');
  });

  it('separates two people behind one address', async () => {
    const a = await track({ user: { id: 'user-1' }, ip: '203.0.113.7' });
    const b = await track({ user: { id: 'user-2' }, ip: '203.0.113.7' });
    expect(a).not.toEqual(b);
  });

  it('falls back to the address before sign-in', async () => {
    await expect(track({ ip: '203.0.113.7' })).resolves.toBe('ip:203.0.113.7');
  });

  it('prefers the forwarded address when there is one', async () => {
    await expect(
      track({ ips: ['198.51.100.4'], ip: '10.0.0.1' }),
    ).resolves.toBe('ip:198.51.100.4');
  });

  it('never returns an empty key', async () => {
    await expect(track({})).resolves.toBe('ip:unknown');
  });
});
