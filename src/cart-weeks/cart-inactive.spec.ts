jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { CartWeeksService } from './cart-weeks.service';

/** The stand and an inactive publisher (1 November 2026). */
describe('the stand gives an inactive publisher no time', () => {
  const user = { id: 'u1', congregationId: 'c1' } as never;
  const codeOf = async (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: { getResponse?: () => { code?: string } }) =>
        e.getResponse?.().code ?? 'thrown',
    );
  const span = { startTime: '10:00', endTime: '12:00' };

  it('he cannot sign himself up, and is told to see the elders', async () => {
    const svc = Object.create(CartWeeksService.prototype) as CartWeeksService;
    Object.assign(svc, {
      publishersRepo: {
        findOne: () =>
          Promise.resolve({
            id: 'p1',
            capabilities: { public_witnessing: true },
            appointment: 'publisher',
            status: 'inactive',
          }),
      },
    });
    expect(await codeOf(svc.request('c1', 'd1', user, span))).toBe(
      'SIGNUP_UNAVAILABLE',
    );
  });

  it('the one who arranges the stand cannot put him on', async () => {
    const svc = Object.create(CartWeeksService.prototype) as CartWeeksService;
    Object.assign(svc, {
      daysRepo: {
        manager: { getRepository: () => ({ count: () => Promise.resolve(1) }) },
      },
    });
    expect(
      await codeOf(
        svc.assign('c1', 'd1', user, { publisherId: 'p1', ...span }),
      ),
    ).toBe('PERSON_NOT_ASSIGNABLE');
  });
});
