import { addDaysISO, weekRules, type WeekRules } from '../common/week-rules';
import {
  TEMPLATE_KEYS,
  TEMPLATE_TOKENS,
  defaultWords,
  fill,
  say,
  strayBraces,
  hasControlChars,
  tokensIn,
  unknownTokens,
  type TemplateKey,
  type TemplateSetting,
} from './announcement-templates';
import { suggestionsFrom, type SuggestionEvent } from './suggestion-rules';
import { fitsWeek, staleReason } from './announcement-suggestions.service';
import { SUPPORTED_LANGUAGES } from '../common/i18n/supported-languages';

/** The «Templates» screen's rules (announcements R-09 step 4). */
describe('template words', () => {
  it('the app’s own words use only the template’s placeholders, in every language', () => {
    for (const lang of SUPPORTED_LANGUAGES)
      for (const key of TEMPLATE_KEYS) {
        const w = defaultWords(key, lang);
        if (!TEMPLATE_TOKENS[key].length) {
          expect(w).toBeNull();
          continue;
        }
        expect(w).not.toBeNull();
        expect(unknownTokens(key, w!)).toEqual([]);
        // Every placeholder the template has is in its default words.
        expect(new Set(tokensIn(w!))).toEqual(new Set(TEMPLATE_TOKENS[key]));
      }
  });

  it('a placeholder the template does not know is named', () => {
    expect(unknownTokens('general_cleaning', '{when} и {dtae}')).toEqual([
      'dtae',
    ]);
    expect(unknownTokens('memorial.ahead', '{when}')).toEqual([]);
  });

  it('leaves the words exactly as written when every value is there', () => {
    const words =
      'Внимание:\n- первое — {when}\n- второе: 19:30\nСсылка: https://a.b/c-';
    expect(fill(words, { when: '9:00' })).toBe(
      'Внимание:\n- первое — 9:00\n- второе: 19:30\nСсылка: https://a.b/c-',
    );
  });

  it('a label left empty goes whole; an empty value at the start leaves a capital', () => {
    expect(
      fill('Покажите программу.\nПрограмма: {program}', { program: null }),
    ).toBe('Покажите программу.');
    expect(fill('{midweek} — встреча в будни.', {})).toBe('Встреча в будни.');
  });

  it('a placeholder with spaces is a placeholder, and unknown', () => {
    expect(unknownTokens('general_cleaning', '{ when } уборка')).toEqual([
      ' when ',
    ]);
  });

  it('fills, and tidies what a missing value leaves behind', () => {
    expect(fill('{when} — уборка.', { when: 'Суббота, 9:00' })).toBe(
      'Суббота, 9:00 — уборка.',
    );
    expect(fill('Посещение. Встреча в будни — {midweek}.', {})).toBe(
      'Посещение. Встреча в будни.',
    );
    expect(fill('{program}', { program: null })).toBe('');
  });

  it('what an empty value leaves is tidied near it only (independent check)', () => {
    const none = { when: null, program: null };
    expect(fill('Внимание: важно.\n- {program}\n- Цена : 5', none)).toBe(
      'Внимание: важно.\n- Цена : 5',
    );
    expect(fill('Уборка в {when}: приходите', none)).toBe(
      'Уборка в: приходите',
    );
    expect(fill('Встреча ({when}) будет', none)).toBe('Встреча будет');
    expect(fill('Текст.\nПрограмма:\n{program}', none)).toBe('Текст.');
  });

  it('the Memorial’s own words with {place}: no address yet leaves no stray comma', () => {
    const words = defaultWords('memorial.ahead', 'ru')!;
    expect(words).toBe(
      'Вечеря воспоминания — {when}, {place}. Пригласим на неё всех, кого знаем.',
    );
    expect(fill(words, { when: 'понедельник, 22 марта', place: null })).toBe(
      'Вечеря воспоминания — понедельник, 22 марта. Пригласим на неё всех, кого знаем.',
    );
  });

  it('a brace outside a placeholder and a control character are named', () => {
    expect(
      ['{{when}}', '{when\n}', 'a } b', '{when} и {program}'].map(strayBraces),
    ).toEqual([true, true, true, false]);
    expect(['a\u0000b', 'a\u0007', 'a\nb\tc'].map(hasControlChars)).toEqual([
      true,
      true,
      false,
    ]);
  });
});

const VERSIONS = [
  {
    effectiveFrom: '2020-01-01',
    midweekDow: 3,
    weekendDow: 7,
    midweekTime: '19:00',
    weekendTime: '13:00',
  },
];
function weeksFrom(monday: string, count: number, events: SuggestionEvent[]) {
  const map = new Map<string, WeekRules>();
  for (let i = 0; i < count; i++) {
    const w = addDaysISO(monday, 7 * i);
    map.set(w, weekRules({ weekStart: w, versions: VERSIONS, events }));
  }
  return map;
}
const memorial: SuggestionEvent = {
  id: 'm',
  type: 'memorial',
  date: '2027-03-22',
  endDate: null,
  time: '19:30',
  coMidweekDow: null,
};
const run = (templates: Map<TemplateKey, TemplateSetting>) =>
  suggestionsFrom({
    lang: 'ru',
    weeks: weeksFrom('2027-01-18', 12, [memorial]),
    events: [memorial],
    fieldService: [],
    audits: [],
    templates,
  }).filter((s) => s.topic === 'memorial');

describe('the congregation’s settings in the rules', () => {
  it('a template turned off is not offered', () => {
    const got = run(
      new Map([
        ['memorial.ahead', { enabled: false, words: null, weeksAhead: null }],
      ]),
    );
    // Still computed (an announcement taken before must not look «gone»);
    // the service offers only those on.
    expect(got.map((s) => [s.stage, s.enabled])).toEqual([
      ['ahead', false],
      ['next', true],
    ]);
  });

  it('its own words, filled with the moment’s values', () => {
    const [ahead] = run(
      new Map([
        [
          'memorial.ahead',
          {
            enabled: true,
            words: 'Вечеря — {when}. Приглашения у служебных групп.',
            weeksAhead: null,
          },
        ],
      ]),
    );
    expect(ahead.text).toBe(
      'Вечеря — понедельник, 22 марта, 19:30. Приглашения у служебных групп.',
    );
  });

  it('its own number of weeks', () => {
    const [ahead] = run(
      new Map([
        ['memorial.ahead', { enabled: true, words: null, weeksAhead: 3 }],
      ]),
    );
    expect(ahead.targetWeek).toBe('2027-03-01');
  });

  it('no settings: the app’s own (five weeks, the app’s words)', () => {
    const [ahead] = run(new Map());
    expect(ahead.targetWeek).toBe('2027-02-15');
    expect(ahead.text).toContain('Пригласим на неё всех');
  });
});

describe('say', () => {
  const own = () => 'the app’s words';
  const t = (words: string) =>
    new Map<TemplateKey, TemplateSetting>([
      ['assembly_screens', { words, enabled: true, weeksAhead: null }],
    ]);
  it('own words that come out empty this time: the app’s words stand in', () => {
    expect(
      say(t('Программа: {program}'), 'assembly_screens', own, {
        program: null,
      }),
    ).toBe('the app’s words');
  });
  it('own words with the value given are used', () => {
    expect(
      say(t('Программа: {program}'), 'assembly_screens', own, {
        program: 'https://example.invalid/p',
      }),
    ).toBe('Программа: https://example.invalid/p');
  });
});

describe('the number of weeks changed after one was taken', () => {
  const weeks = (n: number) =>
    run(
      new Map([
        ['memorial.ahead', { enabled: true, words: null, weeksAhead: n }],
      ]),
    );
  it('a taken «ahead» stays right in its earlier week', () => {
    const [was] = weeks(5);
    const [now] = weeks(3);
    expect(now.targetWeek).not.toBe(was.targetWeek);
    const row = {
      weekStartDate: was.targetWeek,
      sourceFacts: was.facts,
      eventType: 'midweek',
    };
    expect(staleReason(row, now, () => true)).toBeNull();
    // Its meeting no longer held there (a convention that week): moved.
    expect(staleReason(row, now, () => false)).toBe('moved');
    // The event itself moved: its facts changed too — moved.
    expect(fitsWeek(row, { ...now, anchorWeek: was.targetWeek })).toBe(false);
  });
  it('an «ahead» that now falls on the last week is computed, not offered', () => {
    // An assembly the week before the Memorial holds no meeting: the last
    // week before is two weeks back — where two weeks ahead also falls.
    const assembly: SuggestionEvent = {
      id: 'a',
      type: 'circuit_assembly',
      date: '2027-03-20',
      endDate: null,
      time: null,
      coMidweekDow: null,
    };
    const got = suggestionsFrom({
      lang: 'ru',
      weeks: weeksFrom('2027-01-18', 12, [memorial, assembly]),
      events: [memorial, assembly],
      fieldService: [],
      audits: [],
      templates: new Map([
        ['memorial.ahead', { enabled: true, words: null, weeksAhead: 2 }],
      ]),
    }).filter((s) => s.topic === 'memorial');
    expect(got.map((s) => [s.stage, s.targetWeek, s.enabled])).toEqual([
      ['ahead', '2027-03-08', false],
      ['next', '2027-03-08', true],
    ]);
  });
});

describe('a gap is warned about only where the words have the placeholder', () => {
  const noTime = { ...memorial, time: null };
  const gapsWith = (words: string | null) =>
    suggestionsFrom({
      lang: 'ru',
      weeks: weeksFrom('2027-01-18', 12, [noTime]),
      events: [noTime],
      fieldService: [],
      audits: [],
      templates: new Map([
        ['memorial.next', { enabled: true, words, weeksAhead: null }],
      ]),
    }).find((s) => s.key === 'memorial:next:m')!.gaps;
  it('the app’s words, own words with {when}: the time is missing', () => {
    expect([gapsWith(null), gapsWith('Вечеря — {when}.')]).toEqual([
      ['time'],
      ['time'],
    ]);
  });
  it('own words without {when}: nothing to warn about', () => {
    expect(gapsWith('Вечеря на следующей неделе.')).toEqual([]);
  });
});
