import { SpecialEventsService } from './special-events.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * The day this list cuts on comes from the congregation, not from a string.
 *
 * «What is still ahead» is decided by comparing each event against today, and
 * today used to be built by an Intl formatter with the region written in as a
 * literal. Right for Ahlen, wrong for anyone else — and invisible to every
 * sweep, including the guard test, which looked only for a UTC timestamp being
 * sliced and not for a zone spelled out.
 *
 * It was also invisible to me for a whole evening for a sillier reason: the
 * folder is called «special-events», and a `grep -v spec` meant to skip test
 * files swallowed the entire directory.
 *
 * There was no test file here at all until now, which is the other half of why
 * it lasted.
 */
describe('SpecialEventsService.findAll — which day is "today"', () => {
  function build() {
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repo: any = { createQueryBuilder: jest.fn(() => qb) };
    const svc = new SpecialEventsService(
      repo,
      {} as never,
      {} as never,
      clockStub('Pacific/Auckland'),
    );
    return { svc, qb };
  }

  it('asks the congregation clock rather than a timezone written in the code', async () => {
    // Auckland is a day ahead of Berlin for most of the year. If the zone were
    // still a literal, the cut-off would be Berlin's day whatever the
    // congregation's own is — and this test would see the wrong date.
    //
    // The expectation is taken from the CLOCK, not built here with a zone of
    // its own: a test that computes the answer a second way agrees with the
    // code only until the two ways diverge, which is the whole fault being
    // guarded against. (The guard test caught this file doing exactly that.)
    const { svc, qb } = build();
    const expected = await clockStub('Pacific/Auckland').todayFor('cong-1');

    await svc.findAll('cong-1', {});

    const todayCall = qb.andWhere.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(':today'),
    );
    expect(todayCall).toBeDefined();
    expect(todayCall[1]).toEqual({ today: expected });
  });

  it('does not filter by day at all when everything was asked for', async () => {
    const { svc, qb } = build();

    await svc.findAll('cong-1', { all: 'true' });

    const todayCall = qb.andWhere.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes(':today'),
    );
    expect(todayCall).toBeUndefined();
  });

  it('honours an explicit "since" instead of today', async () => {
    const { svc, qb } = build();

    await svc.findAll('cong-1', { since: '2020-01-01' });

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(':since'),
      {
        since: '2020-01-01',
      },
    );
  });
});
