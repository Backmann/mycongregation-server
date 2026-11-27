import { addDaysISO, weekRules, type WeekRules } from '../common/week-rules';
import {
  factsOf,
  suggestionsFrom,
  type SuggestionEvent,
  type SuggestionInput,
} from './suggestion-rules';

// A congregation like the live one: midweek on Wednesday at 19:00, weekend
// on Sunday at 13:00.
const VERSIONS = [
  {
    effectiveFrom: '2020-01-01',
    midweekDow: 3,
    weekendDow: 7,
    midweekTime: '19:00',
    weekendTime: '13:00',
  },
];

function weeksFrom(
  monday: string,
  count: number,
  events: SuggestionEvent[],
): Map<string, WeekRules> {
  const map = new Map<string, WeekRules>();
  for (let i = 0; i < count; i++) {
    const w = addDaysISO(monday, 7 * i);
    map.set(w, weekRules({ weekStart: w, versions: VERSIONS, events }));
  }
  return map;
}

function run(
  events: SuggestionEvent[],
  more: Partial<SuggestionInput> = {},
  from = '2026-11-23',
  count = 18,
) {
  return suggestionsFrom({
    lang: 'ru',
    weeks: weeksFrom(from, count, events),
    events,
    fieldService: [],
    audits: [],
    ...more,
  });
}

const ev = (e: Partial<SuggestionEvent> & { type: string; date: string }) => ({
  id: `${e.type}-${e.date}`,
  endDate: null,
  time: null,
  coMidweekDow: null,
  ...e,
});

describe('the general cleaning', () => {
  const cleaning = ev({
    type: 'general_cleaning',
    date: '2027-03-13',
    time: '09:00',
  });

  it('goes to the last meeting before it, with day, date and hour', () => {
    const [s] = run([cleaning], {}, '2027-02-22', 6).filter(
      (x) => x.topic === 'general_cleaning',
    );
    expect(s.targetWeek).toBe('2027-03-08');
    expect(s.meetings).toEqual([{ kind: 'midweek', date: '2027-03-10' }]);
    expect(s.defaultKinds).toEqual(['midweek']);
    expect(s.text).toBe(
      'Суббота, 13 марта, 9:00 — генеральная уборка Зала царства. Приглашаются все.',
    );
    expect(s.gaps).toEqual([]);
    expect(s.eventId).toBe(cleaning.id);
  });

  it('no hour yet: never a guess, never «[время]» — said to be told later, and the writer warned', () => {
    const [s] = run([{ ...cleaning, time: null }], {}, '2027-02-22', 6);
    expect(s.text).not.toContain('[');
    expect(s.text).toContain('Время сообщим позже.');
    expect(s.gaps).toEqual(['time']);
  });

  it('changes its fingerprint when the hour changes, not otherwise', () => {
    const a = run([cleaning], {}, '2027-02-22', 6)[0].facts;
    const b = run([cleaning], {}, '2027-02-22', 6)[0].facts;
    const c = run([{ ...cleaning, time: '08:30' }], {}, '2027-02-22', 6)[0]
      .facts;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('on a meeting day, only the meetings of the days before count', () => {
    const sunday = { ...cleaning, date: '2027-03-14' };
    const [s] = run([sunday], {}, '2027-02-22', 6);
    expect(s.meetings).toEqual([{ kind: 'midweek', date: '2027-03-10' }]);
  });

  it('keeps German weekdays capitalised', () => {
    const [s] = suggestionsFrom({
      lang: 'de',
      weeks: weeksFrom('2027-02-22', 6, [cleaning]),
      events: [cleaning],
      fieldService: [],
      audits: [],
    });
    expect(s.text).toMatch(/^Samstag, 13\. März, 9:00: Grundreinigung/);
  });
});

describe('the circuit overseer visit', () => {
  const visit = ev({
    type: 'circuit_overseer_visit',
    date: '2027-02-23',
    endDate: '2027-02-28',
    coMidweekDow: 2,
  });
  const all = () =>
    run([visit], {}, '2026-12-28', 12).filter((s) => s.topic === 'co_visit');

  it('is offered four weeks ahead and again the week before, for both meetings', () => {
    const [ahead, next] = all();
    expect(ahead.stage).toBe('ahead');
    expect(ahead.targetWeek).toBe('2027-01-25');
    expect(next.stage).toBe('next');
    expect(next.targetWeek).toBe('2027-02-15');
    expect(next.defaultKinds).toEqual(['midweek', 'weekend']);
  });

  it('names the moved midweek meeting from the week rules', () => {
    const [ahead, next] = all();
    expect(ahead.text).toBe(
      'С 23 по 28 февраля — посещение районного старейшины. Встреча в будни на той неделе — вторник, 23 февраля, 19:00.',
    );
    expect(next.text).toContain('На следующей неделе');
    expect(next.text).toContain('вторник, 23 февраля, 19:00');
  });

  it('does not offer «ahead» when the visit is too close for it', () => {
    const got = run([visit], {}, '2027-02-08', 4).filter(
      (s) => s.topic === 'co_visit',
    );
    expect(got.map((s) => s.stage)).toEqual(['next']);
  });
});

it('German keeps the weekday capitalised inside a sentence too', () => {
  const visit = ev({
    type: 'circuit_overseer_visit',
    date: '2027-02-23',
    endDate: '2027-02-28',
    coMidweekDow: 2,
  });
  const [s] = suggestionsFrom({
    lang: 'de',
    weeks: weeksFrom('2027-02-08', 4, [visit]),
    events: [visit],
    fieldService: [],
    audits: [],
  });
  expect(s.text).toContain('Dienstag, 23. Februar, 19:00');
  expect(s.text).toContain('vom 23. bis 28. Februar');
  const [en] = suggestionsFrom({
    lang: 'en',
    weeks: weeksFrom('2027-02-08', 4, [visit]),
    events: [visit],
    fieldService: [],
    audits: [],
  });
  expect(en.text).toContain('from February 23 to 28');
});

describe('a visit and an assembly in the same week', () => {
  // The week holds no meetings at all: the midweek sentence is left out
  // rather than naming a meeting that does not happen (independent check).
  const visit = ev({
    type: 'circuit_overseer_visit',
    date: '2027-01-12',
    endDate: '2027-01-17',
    coMidweekDow: 2,
  });
  const assembly = ev({ type: 'circuit_assembly', date: '2027-01-17' });
  it('says nothing of a midweek meeting', () => {
    const got = run([visit, assembly], {}, '2026-12-21', 6).filter(
      (s) => s.topic === 'co_visit',
    );
    expect(got.length).toBeGreaterThan(0);
    for (const s of got) {
      expect(s.text).not.toContain('Встреча в будни');
      expect(s.text).toContain('посещение районного старейшины.');
    }
  });
});

describe('facts', () => {
  it('do not change with the language', () => {
    const visit = ev({
      type: 'circuit_overseer_visit',
      date: '2027-02-23',
      endDate: '2027-02-28',
      coMidweekDow: 2,
    });
    const of = (lang: 'ru' | 'de') =>
      suggestionsFrom({
        lang,
        weeks: weeksFrom('2027-02-08', 4, [visit]),
        events: [visit],
        fieldService: [],
        audits: [],
      })[0].facts;
    expect(of('de')).toBe(of('ru'));
  });
  it('an event suggestion is anchored to the week of the event', () => {
    const memorial = ev({ type: 'memorial', date: '2027-03-22' });
    const got = run([memorial], {}, '2027-01-18', 12).filter(
      (s) => s.topic === 'memorial',
    );
    expect(got.map((s) => s.anchorWeek)).toEqual(['2027-03-22', '2027-03-22']);
  });
});

describe('the Memorial', () => {
  const memorial = ev({ type: 'memorial', date: '2027-03-22' });

  it('five weeks ahead on the midweek meeting, and the week before on both', () => {
    const got = run([memorial], {}, '2027-01-18', 12).filter(
      (s) => s.topic === 'memorial',
    );
    expect(got.map((s) => [s.stage, s.targetWeek, s.defaultKinds])).toEqual([
      ['ahead', '2027-02-15', ['midweek']],
      ['next', '2027-03-15', ['midweek', 'weekend']],
    ]);
  });

  it('no hour yet (as on the live site, 26 November 2026): weeks ahead that is ordinary', () => {
    const [s] = run([memorial], {}, '2027-01-18', 12);
    expect(s.text).toBe(
      'Вечеря воспоминания — понедельник, 22 марта. Время сообщим позже. Пригласим на неё всех, кого знаем.',
    );
    expect(s.gaps).toEqual([]);
  });

  it('the week before, an hour still missing is a warning to the writer', () => {
    const next = run([memorial], {}, '2027-01-18', 12).find(
      (s) => s.stage === 'next',
    )!;
    expect(next.text).toBe(
      'На следующей неделе — Вечеря воспоминания: понедельник, 22 марта. Время сообщим дополнительно.',
    );
    expect(next.gaps).toEqual(['time']);
  });

  it('the hour and the address once known; a taken one is then «changed»', () => {
    const before = run([memorial], {}, '2027-01-18', 12)[0];
    const known = run(
      [{ ...memorial, time: '19:30', address: 'Musterstraße 1, Hamm' }],
      {},
      '2027-01-18',
      12,
    )[0];
    expect(known.text).toBe(
      'Вечеря воспоминания — понедельник, 22 марта, 19:30, Musterstraße 1, Hamm. Пригласим на неё всех, кого знаем.',
    );
    expect(known.facts).not.toBe(before.facts);
    // No address given: the fingerprint is what it was before addresses
    // counted, so nothing taken earlier turns «changed» by itself.
    expect(before.facts).toBe(factsOf(memorial.date, null));
  });
});

describe('conventions (R-04, R-06)', () => {
  const assembly = ev({ type: 'circuit_assembly', date: '2027-01-24' });

  it('the last week before is the last week that holds a meeting', () => {
    // The assembly week holds no meetings at all (week rules).
    const next = run([assembly]).find((s) =>
      s.key.startsWith('convention:next'),
    );
    expect(next?.targetWeek).toBe('2027-01-11');
    expect(next?.meetings).toEqual([
      { kind: 'midweek', date: '2027-01-13' },
      { kind: 'weekend', date: '2027-01-17' },
    ]);
    expect(next?.text).toContain('районный конгресс (24 января)');
  });

  it('the reminder goes ten weeks ahead, to the midweek meeting', () => {
    const ahead = run([assembly], {}, '2026-11-02', 14).find((s) =>
      s.key.startsWith('convention:ahead'),
    );
    expect(ahead?.targetWeek).toBe('2026-11-09');
    expect(ahead?.defaultKinds).toEqual(['midweek']);
    // Before the map begins — not offered at all.
    const live = run([assembly], {}, '2026-11-23', 18).find((s) =>
      s.key.startsWith('convention:ahead'),
    );
    expect(live).toBeUndefined();
  });

  it('a regional convention names its days', () => {
    const regional = ev({
      type: 'regional_convention',
      date: '2027-07-30',
      endDate: '2027-08-01',
    });
    const ahead = run([regional], {}, '2027-05-03', 14).find((s) =>
      s.key.startsWith('convention:ahead'),
    );
    expect(ahead?.text).toBe(
      'Региональный конгресс — 30 июля – 1 августа. Запланируйте, пожалуйста, это время заранее.',
    );
    expect(ahead?.defaultKinds).toEqual(['midweek']);
  });
});

describe('meetings for field service (R-08)', () => {
  const fs = (more: object) => ({
    date: '2027-02-20',
    time: '10:00',
    published: true,
    cancelled: false,
    movedFromDate: null,
    notice: null,
    ...more,
  });

  it('a published meeting called off is told at the meetings before it', () => {
    const [s] = run(
      [],
      { fieldService: [fs({ cancelled: true })] },
      '2027-02-08',
      4,
    );
    expect(s.topic).toBe('field_service');
    expect(s.targetWeek).toBe('2027-02-15');
    expect(s.meetings).toEqual([{ kind: 'midweek', date: '2027-02-17' }]);
    expect(s.text).toBe(
      'Суббота, 20 февраля, 10:00: встреча для проповеди отменяется.',
    );
  });

  it('a draft, or one with nothing different, is not offered', () => {
    expect(
      run(
        [],
        { fieldService: [fs({ cancelled: true, published: false })] },
        '2027-02-08',
        4,
      ),
    ).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ topic: 'field_service' }),
      ]),
    );
    expect(
      run([], { fieldService: [fs({})] }, '2027-02-08', 4).filter(
        (s) => s.topic === 'field_service',
      ),
    ).toEqual([]);
  });

  it('a move and a word for this time are told too, in order', () => {
    const [s] = run(
      [],
      {
        fieldService: [
          fs({
            date: '2027-02-21',
            time: '13:00',
            movedFromDate: '2027-02-20',
          }),
          fs({ notice: 'собираемся у входа в парк' }),
        ],
      },
      '2027-02-08',
      4,
    ).filter((x) => x.topic === 'field_service');
    expect(s.text).toBe(
      'Суббота, 20 февраля, 10:00, встреча для проповеди: собираемся у входа в парк Воскресенье, 21 февраля, 13:00: встреча для проповеди (перенесена с 20 февраля).',
    );
  });
});

describe('the accounts (R-04)', () => {
  it('each month: the first midweek meeting reports on the month before', () => {
    const got = run([]).filter((s) => s.topic === 'accounts_month');
    // November had begun before the weeks in view: it is not offered mid-month.
    expect(got[0].key).toBe('accounts_month:2026-11');
    expect(got[0].targetWeek).toBe('2026-11-30');
    expect(got[0].meetings[0]).toEqual({ kind: 'midweek', date: '2026-12-02' });
    expect(got[0].text).toBe(
      'Отчёт о счетах собрания за ноябрь: [текст отчёта]',
    );
    expect(got[0].gaps).toEqual(['report']);
    expect(got.map((s) => s.key)).not.toContain('accounts_month:2026-10');
  });

  it('the audit, once done, goes to the next midweek meeting', () => {
    const got = run([], {
      audits: [
        { period: '2026-Q1', doneOn: '2026-12-10' },
        { period: '2027-Q2', doneOn: '2027-03-05' },
      ],
    }).filter((s) => s.topic === 'accounts_audit');
    expect(got.map((s) => [s.targetWeek, s.text])).toEqual([
      [
        '2026-12-14',
        'Проверка счетов собрания за сентябрь – ноябрь проведена.',
      ],
      [
        '2027-03-08',
        'Проверка счетов собрания за декабрь – февраль проведена.',
      ],
    ]);
  });

  it('an audit done before the weeks in view is history', () => {
    const got = run([], {
      audits: [{ period: '2026-Q4', doneOn: '2026-09-21' }],
    }).filter((s) => s.topic === 'accounts_audit');
    expect(got).toEqual([]);
  });
});
