jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { CartWeeksService } from './cart-weeks.service';

/** The stand and an inactive publisher (1 November 2026). */
describe('the stand gives an inactive publisher no shift', () => {
  const user = { id: 'u1', congregationId: 'c1' } as never;
  const codeOf = async (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: { getResponse?: () => { code?: string } }) =>
        e.getResponse?.().code ?? String(e),
    );

  it('he cannot sign himself up, and is told to see the elders', async () => {
    const svc = Object.create(CartWeeksService.prototype) as CartWeeksService;
    Object.assign(svc, {
      publishersRepo: {
        findOne: () =>
          Promise.resolve({
            id: 'p1',
            capabilities: { public_witnessing: true },
            status: 'inactive',
          }),
      },
    });
    expect(await codeOf(svc.applyToSlot('c1', 's1', user, {} as never))).toBe(
      'SIGNUP_UNAVAILABLE',
    );
  });

  it('the one who plans the stand cannot put him on a shift', async () => {
    const svc = Object.create(CartWeeksService.prototype) as CartWeeksService;
    Object.assign(svc, {
      slotsRepo: {
        manager: { getRepository: () => ({ count: () => Promise.resolve(1) }) },
      },
    });
    expect(
      await codeOf(
        svc.assignToSlot('c1', 's1', user, { publisherId: 'p1' } as never),
      ),
    ).toBe('PERSON_NOT_ASSIGNABLE');
  });
});
