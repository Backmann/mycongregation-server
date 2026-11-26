import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { addDaysISO, weekRules } from '../common/week-rules';
import {
  AnnouncementSuggestionsService,
  staleReason,
} from './announcement-suggestions.service';
import { TakeSuggestionDto, SuggestionKeyDto } from './dto/suggestion.dto';
import type { Suggestion } from './suggestion-rules';

/**
 * The service around the rules, with the clock and the tables faked — the
 * cases the independent check found (26 November 2026).
 */
const VERSIONS = [
  {
    effectiveFrom: '2020-01-01',
    midweekDow: 3,
    weekendDow: 7,
    midweekTime: '19:00',
    weekendTime: '13:00',
  },
];
const CLEANING = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'general_cleaning',
  date: '2026-11-28',
  endDate: null,
  time: '09:00',
  coMidweekDow: null,
};

function service(opts: {
  today: string;
  events?: object[];
  tasks?: object[];
  rows?: object[];
  dismissals?: object;
}) {
  const writer = { assertWriter: jest.fn(async () => undefined) };
  const svc = new AnnouncementSuggestionsService(
    writer as never,
    {
      forWeeks: async (_c: string, mondays: string[]) =>
        new Map(
          mondays.map((w) => [
            w,
            weekRules({
              weekStart: w,
              versions: VERSIONS,
              events: (opts.events ?? []) as never,
            }),
          ]),
        ),
    } as never,
    {
      todayFor: async () => opts.today,
      timezoneOf: async () => 'Europe/Berlin',
    } as never,
    { find: async () => opts.rows ?? [] } as never,
    (opts.dismissals ?? { find: async () => [] }) as never,
    { find: async () => opts.events ?? [] } as never,
    { find: async () => [] } as never,
    { find: async () => opts.tasks ?? [] } as never,
    { findOne: async () => ({ id: 'c', language: 'ru' }) } as never,
    { load: async () => new Map() } as never,
  );
  return svc;
}
const user = { id: 'u', congregationId: 'c', role: 'admin' } as never;

describe('a taken announcement whose meeting has been held', () => {
  it('is not «gone» on the Thursday after its Wednesday', async () => {
    const before = await service({
      today: '2026-11-23',
      events: [CLEANING],
    }).compute('c');
    const s = before.all.find((x) => x.topic === 'general_cleaning')!;
    const row = {
      id: 'a',
      sourceKey: `${s.key}.midweek`,
      sourceFacts: s.facts,
      weekStartDate: '2026-11-23',
    };
    const thursday = await service({
      today: '2026-11-26',
      events: [CLEANING],
      rows: [row],
    }).forWeek(user, '2026-11-23');
    expect(thursday.stale).toEqual([]);
    const summary = await service({
      today: '2026-11-26',
      events: [CLEANING],
      rows: [row],
    }).summary(user);
    expect(summary.stale).toBe(0);
  });

  it('a past week is not judged at all', async () => {
    const got = await service({
      today: '2026-12-01',
      rows: [
        {
          id: 'a',
          sourceKey: 'general_cleaning:x.midweek',
          sourceFacts: 'f',
          weekStartDate: '2026-11-23',
        },
      ],
    }).forWeek(user, '2026-11-23');
    expect(got.stale).toEqual([]);
  });
});

describe('an audit ticked done late last week', () => {
  it('is offered at this week’s midweek meeting', async () => {
    const got = await service({
      today: '2026-11-23',
      tasks: [
        { kindPeriod: '2026-Q1', doneAt: new Date('2026-11-21T10:00:00Z') },
      ],
    }).forWeek(user, '2026-11-23');
    expect(got.items.map((s) => s.key)).toContain('accounts_audit:2026-Q1');
  });
});

describe('«not needed»', () => {
  it('is kept until the week of the event, not only its own week', async () => {
    // A cleaning on a Monday: the last meeting before it is the Sunday of
    // the week before, so the suggestion's week is earlier than the event's.
    const monday = { ...CLEANING, date: '2026-12-07' };
    let stored: { weekStartDate?: string } = {};
    const dismissals = {
      find: async () => [],
      createQueryBuilder: () => ({
        insert: () => ({
          values: (v: { weekStartDate: string }) => {
            stored = v;
            return { orIgnore: () => ({ execute: async () => undefined }) };
          },
        }),
      }),
    };
    const svc = service({ today: '2026-11-23', events: [monday], dismissals });
    const s = (await svc.compute('c')).all.find(
      (x) => x.topic === 'general_cleaning',
    )!;
    expect(s.targetWeek).toBe('2026-11-30');
    await svc.dismiss(user, s.key);
    expect(stored.weekStartDate).toBe('2026-12-07');
  });
});

describe('the stale reasons', () => {
  const now = {
    targetWeek: '2026-11-23',
    facts: 'abc',
  } as Suggestion;
  it('names what happened', () => {
    const row = { weekStartDate: '2026-11-23', sourceFacts: 'abc' };
    expect(staleReason(row, now)).toBeNull();
    expect(staleReason({ ...row, sourceFacts: 'old' }, now)).toBe('changed');
    expect(
      staleReason(row, { ...now, targetWeek: addDaysISO('2026-11-23', 7) }),
    ).toBe('moved');
    expect(staleReason(row, undefined)).toBe('gone');
  });
});

describe('the keys a writer sends', () => {
  it('accept the audit’s period with its capital Q', async () => {
    const take = plainToInstance(TakeSuggestionDto, {
      weekStartDate: '2026-12-14',
      key: 'accounts_audit:2026-Q1',
      kinds: ['midweek'],
      text: 'Проверка проведена.',
    });
    expect(await validate(take)).toEqual([]);
    const dismiss = plainToInstance(SuggestionKeyDto, {
      key: 'accounts_audit:2026-Q1',
    });
    expect(await validate(dismiss)).toEqual([]);
    for (const key of [
      'memorial:ahead:11111111-1111-1111-1111-111111111111',
      'accounts_month:2026-11',
      'field_service:2026-11-30',
    ]) {
      expect(
        await validate(plainToInstance(SuggestionKeyDto, { key })),
      ).toEqual([]);
    }
  });
  it('refuse anything else', async () => {
    for (const key of ['', 'x', 'memorial:ahead:a b', "'; drop", 'A:b']) {
      expect(
        (await validate(plainToInstance(SuggestionKeyDto, { key }))).length,
      ).toBeGreaterThan(0);
    }
  });
});
