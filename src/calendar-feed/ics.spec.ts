import type { AgendaItem } from '../agenda/agenda.types';
import {
  buildIcs,
  escapeText,
  eventsOf,
  FeedContext,
  FeedOptions,
  foldLine,
  noticeIcs,
  zonedToUtc,
} from './ics';

const ALL: FeedOptions = { mine: true, events: true, names: true };
const CTX: FeedContext = {
  lang: 'ru',
  timezone: 'Europe/Berlin',
  congregation: 'Нордвальд',
  appUrl: 'https://mycongregation.org',
  now: new Date('2026-11-07T19:30:00Z'),
};

const item = (x: Partial<AgendaItem> & Pick<AgendaItem, 'id'>): AgendaItem => ({
  kind: 'part',
  scope: 'mine',
  date: '2026-11-11',
  endDate: null,
  start: '19:00',
  end: '20:45',
  title: 'Чтение Библии',
  detail: null,
  meetingKey: 'midweek:2026-11-11',
  meeting: 'midweek',
  asAssistant: false,
  with: [],
  place: 'Lindenstraße 12, Nordwald',
  mapUrl: null,
  state: 'ok',
  notHeldReason: null,
  eventType: null,
  ...x,
});

/** The ICS with its folding undone, as a calendar reads it. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('ICS text', () => {
  it('escapes what RFC 5545 asks: backslash, semicolon, comma, new line', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds at 75 octets and never inside a Cyrillic letter', () => {
    const line = `SUMMARY:${'Чтение Библии — встреча буднего дня, '.repeat(6)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
      // Each piece is whole UTF-8: no replacement character after a round trip.
      expect(Buffer.from(part, 'utf8').toString('utf8')).not.toContain('�');
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('a short line is left alone', () => {
    expect(foldLine('VERSION:2.0')).toBe('VERSION:2.0');
  });
});

describe('the congregation’s clock to UTC', () => {
  it('winter: Berlin is UTC+1', () => {
    expect(
      zonedToUtc('2026-11-11', '19:00', 'Europe/Berlin').toISOString(),
    ).toBe('2026-11-11T18:00:00.000Z');
  });
  it('summer: UTC+2', () => {
    expect(
      zonedToUtc('2027-06-02', '19:00', 'Europe/Berlin').toISOString(),
    ).toBe('2027-06-02T17:00:00.000Z');
  });
  it('the Sunday the clocks go forward (28 March 2027): 10:00 is already summer', () => {
    expect(
      zonedToUtc('2027-03-28', '10:00', 'Europe/Berlin').toISOString(),
    ).toBe('2027-03-28T08:00:00.000Z');
    expect(
      zonedToUtc('2027-03-27', '10:00', 'Europe/Berlin').toISOString(),
    ).toBe('2027-03-27T09:00:00.000Z');
  });
  it('an hour just before the clocks go forward is still winter (a single guess gets it wrong)', () => {
    expect(
      zonedToUtc('2027-03-28', '01:30', 'Europe/Berlin').toISOString(),
    ).toBe('2027-03-28T00:30:00.000Z');
  });
  it('another zone', () => {
    expect(
      zonedToUtc('2026-11-11', '19:00', 'America/New_York').toISOString(),
    ).toBe('2026-11-12T00:00:00.000Z');
  });
});

describe('events from an agenda', () => {
  it('one meeting is ONE event, with every part of the person inside', () => {
    const evs = eventsOf(
      [
        item({ id: 'part:a', title: 'Чтение Библии', detail: 'Иер 51:1—14' }),
        item({ id: 'duty:b', kind: 'duty', title: 'Микрофон 1' }),
        item({
          id: 'cleaning:c',
          kind: 'cleaning',
          title: 'Уборка после встречи',
          start: '20:45',
          end: '21:15',
        }),
      ],
      ALL,
      CTX,
    );
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      uid: 'midweek:2026-11-11@mycongregation.org',
      summary: 'Чтение Библии и ещё 2 — встреча буднего дня',
      start: '19:00',
      end: '21:15',
      location: 'Lindenstraße 12, Nordwald',
    });
    expect(evs[0].description).toContain('• Чтение Библии · Иер 51:1—14');
    expect(evs[0].description).toContain('• Микрофон 1');
    expect(evs[0].description).toContain('Актуально на 7 ноября');
  });

  it('a meeting that is not held is not in the calendar', () => {
    expect(
      eventsOf(
        [item({ id: 'part:a', state: 'not_held', notHeldReason: 'congress' })],
        ALL,
        CTX,
      ),
    ).toEqual([]);
  });

  it('a day away stays — with a warning in front', () => {
    const [ev] = eventsOf([item({ id: 'part:a', state: 'away' })], ALL, CTX);
    expect(ev.summary).toBe(
      '⚠ вы в отъезде: Чтение Библии — встреча буднего дня',
    );
    expect(ev.description.startsWith('Вы отметили')).toBe(true);
  });

  it('partners by name — and not when names are switched off', () => {
    const it = item({ id: 'part:a', with: ['Лена Кляйн'] });
    expect(eventsOf([it], ALL, CTX)[0].description).toContain(
      '(вместе: Лена Кляйн)',
    );
    expect(
      eventsOf([it], { ...ALL, names: false }, CTX)[0].description,
    ).not.toContain('Лена');
  });

  it('the switches: only mine, only events', () => {
    const items = [
      item({ id: 'part:a' }),
      item({
        id: 'event:e',
        kind: 'event',
        scope: 'event',
        title: 'Региональный конгресс',
        date: '2026-11-20',
        endDate: '2026-11-22',
        start: null,
        end: null,
        meetingKey: null,
        meeting: null,
      }),
    ];
    expect(
      eventsOf(items, { ...ALL, events: false }, CTX).map((e) => e.uid),
    ).toEqual(['midweek:2026-11-11@mycongregation.org']);
    expect(
      eventsOf(items, { ...ALL, mine: false }, CTX).map((e) => e.uid),
    ).toEqual(['event:e@mycongregation.org']);
  });

  it('the Memorial with a part of mine is shown once, as my meeting', () => {
    const key = 'memorial:m1';
    const evs = eventsOf(
      [
        item({
          id: 'memorial_part:x',
          title: 'Вступительная молитва',
          date: '2027-03-22',
          start: '19:30',
          end: '20:30',
          meetingKey: key,
          meeting: 'memorial',
        }),
        item({
          id: 'event:m1',
          kind: 'event',
          scope: 'event',
          title: 'Вечеря воспоминания',
          date: '2027-03-22',
          start: '19:30',
          end: null,
          meetingKey: key,
          meeting: 'memorial',
        }),
      ],
      ALL,
      CTX,
    );
    expect(evs.map((e) => e.summary)).toEqual([
      'Вступительная молитва — Вечеря воспоминания',
    ]);
    // Without a part of mine, the Memorial is there as the event.
    expect(
      eventsOf(
        [
          item({
            id: 'event:m1',
            kind: 'event',
            scope: 'event',
            title: 'Вечеря воспоминания',
            date: '2027-03-22',
            start: '19:30',
            end: null,
            meetingKey: key,
            meeting: 'memorial',
          }),
        ],
        ALL,
        CTX,
      ).map((e) => e.uid),
    ).toEqual(['event:m1@mycongregation.org']);
  });
});

describe('the whole calendar', () => {
  const ics = unfold(
    buildIcs(
      [
        item({ id: 'part:a', title: 'Чтение Библии; часть, «тест»' }),
        item({
          id: 'event:e',
          kind: 'event',
          scope: 'event',
          title: 'Региональный конгресс',
          date: '2026-11-20',
          endDate: '2026-11-22',
          start: null,
          end: null,
          meetingKey: null,
          meeting: null,
          place: 'Messe Dortmund',
        }),
      ],
      ALL,
      CTX,
    ),
  );

  it('is a calendar with CRLF line ends and no alarms', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Собрание Нордвальд');
    expect(ics).not.toContain('VALARM');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('a timed event in UTC: 19:00 in Berlin in November is 18:00Z, 1 h 45 min long', () => {
    expect(ics).toContain('DTSTART:20261111T180000Z');
    expect(ics).toContain('DTEND:20261111T194500Z');
  });

  it('an event of three days: whole days, the end exclusive', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
    expect(ics).toContain('DTEND;VALUE=DATE:20261123');
  });

  it('the text is escaped', () => {
    expect(ics).toContain('SUMMARY:Чтение Библии\\; часть\\, «тест» — встреча');
  });

  it('every event has its own UID and a DTSTAMP', () => {
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(new Set(uids).size).toBe(uids.length);
    expect(ics.match(/^DTSTAMP:/gm)).toHaveLength(uids.length);
  });
});

describe('a link that no longer works', () => {
  const ics = unfold(noticeIcs({ ...CTX, today: '2026-11-08' }));

  it('is a calendar with one notice for today and nothing of the person', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:link-off@mycongregation.org');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261108');
    expect(ics).toContain('DTEND;VALUE=DATE:20261109');
    expect(ics).toContain('SUMMARY:Календарь собрания отключён');
    expect(ics).toContain('Профиль → Календарь');
    expect(ics).not.toContain('VALARM');
  });

  it('in the person’s language', () => {
    expect(
      unfold(noticeIcs({ ...CTX, lang: 'de', today: '2026-11-08' })),
    ).toContain('SUMMARY:Versammlungskalender abgeschaltet');
  });
});
