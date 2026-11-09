import { PioneerType } from '../common/enums/pioneer-type.enum';
import {
  conductorIdsOf,
  conductorsOf,
  inSeason,
  invitedOn,
  repeats,
  seasonYearOf,
  tidyName,
  seasonOf,
  serviceYearOfDay,
} from './pioneer-meeting-rules';
import { meetingText } from './pioneer-meeting-messages';

describe('the annual meeting with the pioneers — rules', () => {
  it('the season is December and January of the service year', () => {
    expect(seasonOf(2027)).toEqual({ from: '2026-12-01', to: '2027-01-31' });
    expect(serviceYearOfDay('2026-12-12')).toBe(2027);
    expect(serviceYearOfDay('2027-01-16')).toBe(2027);
    expect(inSeason('2026-12-12')).toBe(true);
    expect(inSeason('2027-02-01')).toBe(false);
  });

  it('invites the permanent kinds pioneering in its month — not auxiliary, not before or after', () => {
    const spells = [
      {
        publisherId: 'r',
        pioneerType: PioneerType.REGULAR,
        startMonth: '2020-09-01',
        endMonth: null,
      },
      {
        publisherId: 's',
        pioneerType: PioneerType.SPECIAL,
        startMonth: '2026-12-01',
        endMonth: null,
      },
      {
        publisherId: 'm',
        pioneerType: PioneerType.MISSIONARY,
        startMonth: '2019-01-01',
        endMonth: '2026-11-01',
      },
      {
        publisherId: 'late',
        pioneerType: PioneerType.REGULAR,
        startMonth: '2027-01-01',
        endMonth: null,
      },
      {
        publisherId: 'n',
        pioneerType: 'auxiliary',
        startMonth: '2026-12-01',
        endMonth: '2026-12-01',
      },
    ];
    expect(invitedOn(spells, '2026-12-12').sort()).toEqual(['r', 's']);
    // Appointed from January: invited to a January meeting by itself.
    expect(invitedOn(spells, '2027-01-16').sort()).toEqual(['late', 'r', 's']);
  });
});

describe('the annual meeting with the pioneers — who conducts it', () => {
  const cols = {
    conductorPublisherId: null,
    conductorName: null,
    secondConductorPublisherId: null,
    secondConductorName: null,
  };

  it('one or two places, a card or a written name; empty places drop out', () => {
    expect(conductorsOf({ ...cols, conductorPublisherId: 'a' })).toEqual([
      { publisherId: 'a', name: null },
    ]);
    expect(
      conductorsOf({
        ...cols,
        conductorPublisherId: 'a',
        secondConductorName: '  Гость  ',
      }),
    ).toEqual([
      { publisherId: 'a', name: null },
      { publisherId: null, name: 'Гость' },
    ]);
    expect(conductorsOf({ ...cols, secondConductorName: '   ' })).toEqual([]);
    // A card wins over a stray name in the same place.
    expect(
      conductorsOf({ ...cols, conductorPublisherId: 'a', conductorName: 'x' }),
    ).toEqual([{ publisherId: 'a', name: null }]);
    expect(
      conductorIdsOf({
        ...cols,
        conductorName: 'Гость',
        secondConductorPublisherId: 'b',
      }),
    ).toEqual(['b']);
  });

  it('the same person twice is caught, by card or by name in any case', () => {
    expect(
      repeats([
        { publisherId: 'a', name: null },
        { publisherId: 'a', name: null },
      ]),
    ).toBe(true);
    expect(
      repeats([
        { publisherId: null, name: 'Иван  Петров' },
        { publisherId: null, name: 'иван петров' },
      ]),
    ).toBe(true);
    expect(
      repeats([
        { publisherId: 'a', name: null },
        { publisherId: 'b', name: null },
      ]),
    ).toBe(false);
    expect(tidyName('  Иван \n Петров ')).toBe('Иван Петров');
  });

  it('one season: December and the January after it; other months none', () => {
    expect(seasonYearOf('2026-12-01')).toBe(2027);
    expect(seasonYearOf('2027-01-31')).toBe(2027);
    expect(seasonYearOf('2027-12-05')).toBe(2028);
    expect(seasonYearOf('2027-02-01')).toBeNull();
    expect(seasonYearOf('2026-11-30')).toBeNull();
  });
});

describe('the annual meeting with the pioneers — words', () => {
  const f = {
    date: '2026-12-12',
    timeStart: '11:30',
    timeEnd: '12:30',
    place: 'Зал Царства',
    conductorNames: ['Вебер Андреас'],
  };

  it('tells the invited when, where and who conducts it', () => {
    const m = meetingText('created', false, f, 'ru');
    expect(m.title).toBe('Ежегодная встреча старейшин с пионерами');
    expect(m.body).toContain('11:30–12:30');
    expect(m.body).toContain('Зал Царства');
    expect(m.body).toContain('Проводит Вебер Андреас.');
  });

  it('two conductors: «Проводят А и Б»; each conductor hears of the other', () => {
    const two = { ...f, conductorNames: ['Вебер Андреас', 'Фогт Маркус'] };
    expect(meetingText('created', false, two, 'ru').body).toContain(
      'Проводят Вебер Андреас и Фогт Маркус.',
    );
    expect(meetingText('tomorrow', false, two, 'de').body).toContain(
      'Leitung: Вебер Андреас und Фогт Маркус.',
    );
    const mine = meetingText(
      'created',
      true,
      { ...two, partnerName: 'Фогт Маркус' },
      'ru',
    );
    expect(mine.body).toContain('Второй проводящий — Фогт Маркус.');
    // Reverse: alone, there is no second one to name.
    expect(meetingText('created', true, f, 'ru').body).not.toContain('Второй');
    expect(meetingText('conductorFreed', true, f, 'ru').body).toContain(
      'Вы больше не проводите эту встречу.',
    );
  });

  it('tells the elder he conducts it, on the outline S-211', () => {
    const m = meetingText('created', true, f, 'ru');
    expect(m.title).toBe('Вы проводите встречу с пионерами');
    expect(m.body).toContain('S-211');
    expect(meetingText('reminderWeek', true, f, 'de').body).toContain('S-211');
  });

  it('speaks German and English without a Cyrillic letter of its own', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const news of [
        'created',
        'changed',
        'cancelled',
        'tomorrow',
        'reminderWeek',
        'conductorFreed',
      ] as const) {
        const m = meetingText(
          news,
          news === 'reminderWeek',
          { ...f, place: null, conductorNames: [] },
          lang,
        );
        expect(`${m.title} ${m.body}`).not.toMatch(/[А-я]/);
      }
    }
  });
});
