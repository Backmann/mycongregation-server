import { requestContext } from './request-context';

/**
 * The context exists so the journal can name an actor without every service
 * being handed one. Two properties matter: it reaches across awaits inside a
 * request, and it does NOT leak between requests — two people acting at the
 * same moment must never be recorded as each other.
 */
describe('requestContext', () => {
  it('is empty when nothing is acting — that absence means "the system"', () => {
    expect(requestContext.get()).toBeUndefined();
  });

  it('is readable inside the run', () => {
    requestContext.run({ userId: 'u-1', congregationId: 'c-1' }, () => {
      expect(requestContext.get()).toEqual({
        userId: 'u-1',
        congregationId: 'c-1',
      });
    });
  });

  it('survives awaits, which is where a plain variable would fail', async () => {
    await requestContext.run(
      { userId: 'u-1', congregationId: 'c-1' },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        expect(requestContext.get()?.userId).toBe('u-1');
        await Promise.resolve();
        expect(requestContext.get()?.userId).toBe('u-1');
      },
    );
  });

  it('keeps two concurrent actors apart', async () => {
    const seen: string[] = [];
    const act = (id: string, delay: number) =>
      requestContext.run({ userId: id, congregationId: 'c-1' }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push(requestContext.get()!.userId);
      });

    // The slower one finishes last but must still see itself, not the other.
    await Promise.all([act('u-slow', 20), act('u-fast', 1)]);

    expect(seen).toEqual(['u-fast', 'u-slow']);
  });

  it('is gone again once the run ends', async () => {
    await requestContext.run(
      { userId: 'u-1', congregationId: 'c-1' },
      async () => {
        await Promise.resolve();
      },
    );
    expect(requestContext.get()).toBeUndefined();
  });
});
