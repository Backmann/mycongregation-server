import { PioneerType } from '../common/enums/pioneer-type.enum';
import { PioneerSpellsService } from './pioneer-spells.service';
import {
  monthsInclusive,
  noQuotaEligibility,
  noQuotaInServiceYear,
  serviceYearOf,
  overlaps,
  servedMonths,
  yearsAndMonths,
} from './pioneer-history';

const spell = (
  pioneerType: PioneerType,
  startMonth: string,
  endMonth: string | null,
  id = `${startMonth}`,
) => ({ id, pioneerType, startMonth, endMonth });

describe('the pioneer history: what is known, counted once', () => {
  it('counts both ends of a stretch', () => {
    expect(monthsInclusive('1995-09-01', '1999-08-01')).toBe(48);
    expect(monthsInclusive('2026-10', '2026-10')).toBe(1);
    expect(monthsInclusive('2026-10', '2026-09')).toBe(0);
  });

  it('adds regular, special and missionary months — «none» is not pioneering', () => {
    const months = servedMonths(
      [
        spell(PioneerType.REGULAR, '1995-09-01', '1999-08-01'),
        spell(PioneerType.SPECIAL, '1999-09-01', '2003-08-01'),
        spell(PioneerType.MISSIONARY, '2003-09-01', '2004-08-01'),
        spell(PioneerType.NONE, '2010-01-01', '2010-12-01'),
      ],
      '2027-03-01',
    );
    expect(months).toBe(48 + 48 + 12);
  });

  it('a spell still running counts up to the month asked about, not beyond', () => {
    expect(
      servedMonths(
        [spell(PioneerType.REGULAR, '2012-03-01', null)],
        '2027-03-01',
      ),
    ).toBe(181);
    // Appointed from next month: nothing yet.
    expect(
      servedMonths(
        [spell(PioneerType.REGULAR, '2026-11-01', null)],
        '2026-10-01',
      ),
    ).toBe(0);
  });

  it('a month written twice is still one month', () => {
    expect(
      servedMonths(
        [
          spell(PioneerType.REGULAR, '2020-01-01', '2020-12-01'),
          spell(PioneerType.SPECIAL, '2020-07-01', '2021-06-01'),
        ],
        '2027-01-01',
      ),
    ).toBe(18);
  });

  it('says years and months', () => {
    expect(yearsAndMonths(277)).toEqual({ years: 23, months: 1 });
  });

  it('ranges overlap when they share a month; an open end runs on', () => {
    expect(
      overlaps(
        { start: '2020-01', end: '2020-06' },
        { start: '2020-06', end: null },
      ),
    ).toBe(true);
    expect(
      overlaps(
        { start: '2020-01', end: '2020-05' },
        { start: '2020-06', end: null },
      ),
    ).toBe(false);
  });
});

describe('PioneerSpellsService — past spells on the card', () => {
  const make = (rows: ReturnType<typeof spell>[]) => {
    const repo = {
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
      create: jest.fn().mockImplementation((x: unknown) => x),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return { repo, svc: new PioneerSpellsService(repo as never) };
  };
  const today = '2026-10-30';
  const base = { congregationId: 'c1', publisherId: 'p1', todayIso: today };
  const open = spell(PioneerType.REGULAR, '2012-03-01', null, 'open');

  const refusedWith = async (p: Promise<unknown>, code: string) => {
    await expect(p).rejects.toMatchObject({ response: { code } });
  };

  it('takes in an earlier stretch from paper', async () => {
    const { svc, repo } = make([open]);
    await svc.addPast({
      ...base,
      input: { kind: PioneerType.SPECIAL, start: '1999-09', end: '2003-08' },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        pioneerType: PioneerType.SPECIAL,
        startMonth: '1999-09-01',
        endMonth: '2003-08-01',
      }),
    );
  });

  it('refuses a month already in another spell — the running one too', async () => {
    const { svc } = make([open]);
    await refusedWith(
      svc.addPast({
        ...base,
        input: { kind: PioneerType.REGULAR, start: '2010-01', end: '2012-03' },
      }),
      'PIONEER_SPELL_OVERLAP',
    );
  });

  it('refuses a stretch that ends after this month, or ends before it starts', async () => {
    const { svc } = make([]);
    await refusedWith(
      svc.addPast({
        ...base,
        input: { kind: PioneerType.REGULAR, start: '2026-01', end: '2026-11' },
      }),
      'PIONEER_SPELL_FUTURE',
    );
    await refusedWith(
      svc.addPast({
        ...base,
        input: { kind: PioneerType.REGULAR, start: '2005-01', end: '2004-12' },
      }),
      'PIONEER_SPELL_ORDER',
    );
  });

  it('refuses «none» and a month that is not one', async () => {
    const { svc } = make([]);
    await refusedWith(
      svc.addPast({
        ...base,
        input: {
          kind: PioneerType.NONE,
          start: '2005-01',
          end: '2005-02',
        },
      }),
      'PIONEER_SPELL_INVALID',
    );
    await refusedWith(
      svc.addPast({
        ...base,
        input: { kind: PioneerType.REGULAR, start: '2005-13', end: '2006-02' },
      }),
      'PIONEER_SPELL_INVALID',
    );
  });

  it('never touches the running spell — that one follows the card', async () => {
    const { svc, repo } = make([open]);
    await refusedWith(
      svc.removePast({
        congregationId: 'c1',
        publisherId: 'p1',
        spellId: 'open',
      }),
      'PIONEER_SPELL_OPEN',
    );
    await refusedWith(
      svc.updatePast({
        ...base,
        spellId: 'open',
        input: { kind: PioneerType.REGULAR, start: '2011-01', end: '2011-02' },
      }),
      'PIONEER_SPELL_OPEN',
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('a correction is checked against the OTHER spells, not against itself', async () => {
    const past = spell(PioneerType.REGULAR, '1995-09-01', '1999-08-01', 'past');
    const { svc } = make([past, open]);
    const { after } = await svc.updatePast({
      ...base,
      spellId: 'past',
      input: { kind: PioneerType.REGULAR, start: '1995-01', end: '1999-08' },
    });
    expect(after.startMonth).toBe('1995-01-01');
  });

  it('a spell of another card is not found here', async () => {
    const { svc } = make([open]);
    await refusedWith(
      svc.removePast({
        congregationId: 'c1',
        publisherId: 'p1',
        spellId: 'nope',
      }),
      'PIONEER_SPELL_NOT_FOUND',
    );
  });

  it('shows the history newest first, with the sum and how far back it is known', async () => {
    const { svc } = make([
      spell(PioneerType.REGULAR, '1995-09-01', '1999-08-01', 'a'),
      spell(PioneerType.SPECIAL, '1999-09-01', '2003-08-01', 'b'),
      open,
    ]);
    const h = await svc.history('c1', 'p1', today);
    expect(h.spells.map((s) => s.id)).toEqual(['open', 'b', 'a']);
    expect(h.spells[0]).toMatchObject({ end: null, months: 176 });
    expect(h.totalMonths).toBe(48 + 48 + 176);
    expect(h.knownFrom).toBe('1995-09');
  });
});

describe('point 9: serving without the hours requirement', () => {
  it('a service year starts in September', () => {
    expect(serviceYearOf('2026-08-31')).toBe(2026);
    expect(serviceYearOf('2026-09-01')).toBe(2027);
  });

  it('frees the whole year of the decision, and every year until the one it is taken back in', () => {
    const spell = {
      pioneerType: PioneerType.REGULAR,
      noQuotaDecidedOn: '2027-01-18',
      noQuotaEndedOn: '2028-03-02',
    };
    expect(noQuotaInServiceYear(spell, 2026)).toBe(false);
    // Decided in January: September to December are free too.
    expect(noQuotaInServiceYear(spell, 2027)).toBe(true);
    // Taken back in March 2028: that year stays free…
    expect(noQuotaInServiceYear(spell, 2028)).toBe(true);
    // …and the norm returns with the next.
    expect(noQuotaInServiceYear(spell, 2029)).toBe(false);
    expect(noQuotaInServiceYear({ ...spell, noQuotaEndedOn: null }, 2035)).toBe(
      true,
    );
  });

  it('is a regular pioneer’s only', () => {
    expect(
      noQuotaInServiceYear(
        { pioneerType: PioneerType.SPECIAL, noQuotaDecidedOn: '2027-01-18' },
        2027,
      ),
    ).toBe(false);
  });

  it('50 from the birthday on, and fifteen years of every permanent kind', () => {
    const spells = [
      spell(PioneerType.SPECIAL, '1999-09-01', '2003-08-01'),
      spell(PioneerType.REGULAR, '2015-11-01', null),
    ];
    const day = noQuotaEligibility('1976-10-30', spells, '2026-10-30');
    expect(day).toMatchObject({ age: 50, ageOk: true, knownFrom: '1999-09' });
    // 48 + (2015-11 … 2026-10 = 132) = 180 — fifteen years exactly.
    expect(day.servedMonths).toBe(180);
    expect(day.eligible).toBe(true);
    const dayBefore = noQuotaEligibility('1976-10-31', spells, '2026-10-30');
    expect(dayBefore).toMatchObject({ age: 49, ageOk: false, eligible: false });
    const noBirth = noQuotaEligibility(null, spells, '2026-10-30');
    expect(noBirth).toMatchObject({ age: null, eligible: false });
  });
});

describe('PioneerSpellsService — point 9', () => {
  const make = (open: Record<string, unknown> | null) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(open),
      save: jest.fn().mockImplementation((x: unknown) => Promise.resolve(x)),
    };
    return new PioneerSpellsService(repo as never);
  };
  const base = {
    congregationId: 'c1',
    publisherId: 'p1',
    todayIso: '2026-10-30',
  };

  it('refuses anyone but a regular pioneer serving now', async () => {
    await expect(
      make({
        pioneerType: PioneerType.SPECIAL,
        startMonth: '2020-01-01',
        endMonth: null,
      }).setNoQuota({ ...base, decidedOn: '2026-10-01' }),
    ).rejects.toMatchObject({
      response: { code: 'PIONEER_NO_QUOTA_NOT_REGULAR' },
    });
    await expect(
      make(null).setNoQuota({ ...base, decidedOn: '2026-10-01' }),
    ).rejects.toMatchObject({
      response: { code: 'PIONEER_NO_QUOTA_NOT_REGULAR' },
    });
  });

  it('refuses a decision before his pioneering or after today', async () => {
    const svc = make({
      pioneerType: PioneerType.REGULAR,
      startMonth: '2020-01-01',
      endMonth: null,
    });
    for (const decidedOn of ['2019-12-31', '2026-10-31']) {
      await expect(
        svc.setNoQuota({ ...base, decidedOn }),
      ).rejects.toMatchObject({
        response: { code: 'PIONEER_NO_QUOTA_DATE' },
      });
    }
  });

  it('a decision said again undoes a taking-back', async () => {
    const svc = make({
      pioneerType: PioneerType.REGULAR,
      startMonth: '2020-01-01',
      endMonth: null,
      noQuotaDecidedOn: '2025-01-01',
      noQuotaEndedOn: '2026-02-01',
    });
    const { after } = await svc.setNoQuota({
      ...base,
      decidedOn: '2026-10-01',
    });
    expect(after).toMatchObject({
      noQuotaDecidedOn: '2026-10-01',
      noQuotaEndedOn: null,
    });
  });
});
