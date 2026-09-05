import { PioneerSpellsService } from './pioneer-spells.service';
import { PioneerType } from '../common/enums/pioneer-type.enum';

/**
 * Spells follow the card.
 *
 * The migration filled in the past and nothing filled in the future:
 * appointing a pioneer wrote the card and no spell, so the first man appointed
 * after it would have vanished from the pioneer lines of the monthly figures
 * once the readers moved onto spells. These are the four paths that change a
 * card, and the three rules settled for them.
 */
describe('PioneerSpellsService.syncWithCard', () => {
  const make = (open: Record<string, unknown> | null) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(open),
      save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
      create: jest.fn().mockImplementation((x: unknown) => x),
      find: jest.fn().mockResolvedValue([]),
    };
    return { repo, svc: new PioneerSpellsService(repo as never) };
  };
  const base = {
    congregationId: 'c1',
    publisherId: 'p1',
    todayIso: '2026-09-05',
  };

  it('opens a spell when somebody is appointed', async () => {
    const { svc } = make(null);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.REGULAR,
      pioneerSince: '2026-08-01',
    });

    expect(out.opened?.startMonth).toBe('2026-08-01');
    expect(out.opened?.endMonth).toBeNull();
  });

  it('starts at the current month when no date is given', async () => {
    const { svc } = make(null);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.REGULAR,
      pioneerSince: null,
    });

    expect(out.opened?.startMonth).toBe('2026-09-01');
  });

  it('CLOSES the spell when the appointment is removed, and never deletes it', async () => {
    // A congregation's records are not thrown away — the same reason a report
    // is taken back softly rather than destroyed.
    const open = {
      pioneerType: PioneerType.REGULAR,
      startMonth: '2019-09-01',
      endMonth: null,
    };
    const { svc, repo } = make(open);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.NONE,
      pioneerSince: null,
    });

    // The month it ended IN: somebody removed on 5 September served part of
    // September.
    expect(out.closed?.endMonth).toBe('2026-09-01');
    expect(repo.save).toHaveBeenCalled();
  });

  it('MOVES the start when the date is corrected — it does not open a second spell', async () => {
    // «I wrote it down wrong», not «he served twice»: the distinction the app
    // already makes when a report is edited rather than filed again.
    const open = {
      pioneerType: PioneerType.REGULAR,
      startMonth: '2026-09-01',
      endMonth: null,
    };
    const { svc, repo } = make(open);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.REGULAR,
      pioneerSince: '2026-08-01',
    });

    expect(out.moved).toBe(true);
    expect(out.opened).toBeUndefined();
    expect(repo.create).not.toHaveBeenCalled();
    expect(open.startMonth).toBe('2026-08-01');
  });

  it('a change of KIND is two spells, and they do not overlap', async () => {
    const open = {
      pioneerType: PioneerType.REGULAR,
      startMonth: '2019-09-01',
      endMonth: null,
    };
    const { svc } = make(open);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.SPECIAL,
      pioneerSince: '2026-09-01',
    });

    expect(out.closed?.endMonth).toBe('2026-08-01');
    expect(out.opened?.startMonth).toBe('2026-09-01');
  });

  it('does nothing when the card says what the spell already says', async () => {
    const open = {
      pioneerType: PioneerType.REGULAR,
      startMonth: '2019-09-01',
      endMonth: null,
    };
    const { svc, repo } = make(open);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.REGULAR,
      pioneerSince: '2019-09-01',
    });

    expect(out).toEqual({});
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('has nothing to close for a publisher who never pioneered', async () => {
    const { svc, repo } = make(null);

    const out = await svc.syncWithCard({
      ...base,
      pioneerType: PioneerType.NONE,
      pioneerSince: null,
    });

    expect(out).toEqual({});
    expect(repo.save).not.toHaveBeenCalled();
  });
});
