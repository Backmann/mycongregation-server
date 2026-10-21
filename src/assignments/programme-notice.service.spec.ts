jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { BadRequestException } from '@nestjs/common';
import { EventType } from '../common/enums/event-type.enum';
import {
  ProgrammeNoticeService,
  SETTLE_MS,
  SOON_SETTLE_MS,
  dueOf,
  nextLocalHour,
} from './programme-notice.service';

/**
 * An edit of a published meeting is said by itself (21 October 2026): ten
 * minutes after the last edit, a minute when the meeting is near, at 18:00
 * when held for the evening, never at night, never after the meeting began.
 *
 * Berlin: until 25 October 2026 it is UTC+2, after it UTC+1.
 */
const TZ = 'Europe/Berlin';
const CONG = 'c1';
const MIN = 60_000;

/** The midweek meeting of 2–8 November: Wednesday 4 November, 19:00 (18:00Z). */
const NOV = {
  congregationId: CONG,
  weekStartDate: '2026-11-02',
  eventType: EventType.MIDWEEK,
};
/** The midweek meeting of 19–25 October: today, 21 October, 19:00 (17:00Z). */
const TODAY = {
  congregationId: CONG,
  weekStartDate: '2026-10-19',
  eventType: EventType.MIDWEEK,
};

const DATES: Record<string, string> = {
  '2026-11-02': '2026-11-04',
  '2026-10-19': '2026-10-21',
};

type Row = {
  id: string;
  holdUntil: Date | null;
  sentAt: Date | null;
  sentNames: string | null;
};

function make(
  opts: { lastEdit?: string | null; notice?: Partial<Row> | null } = {},
) {
  let flagged = opts.lastEdit !== null;
  const lastEdit = opts.lastEdit ?? '2026-10-21T09:36:00Z';
  let notice: Row | null = opts.notice
    ? {
        id: 'n1',
        holdUntil: null,
        sentAt: null,
        sentNames: null,
        ...opts.notice,
      }
    : null;
  const assignments = {
    find: jest.fn(async () =>
      flagged ? [{ id: 'a1', updatedAt: new Date(lastEdit) }] : [],
    ),
    update: jest.fn(async () => {
      flagged = false;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, unknown> = {};
      for (const k of [
        'select',
        'addSelect',
        'where',
        'andWhere',
        'groupBy',
        'addGroupBy',
      ]) {
        qb[k] = () => qb;
      }
      qb.getRawMany = async () =>
        flagged
          ? [
              {
                congregationId: CONG,
                weekStartDate: current.weekStartDate,
                eventType: 'midweek',
                last: new Date(lastEdit),
              },
            ]
          : [];
      return qb;
    }),
  };
  let current = NOV;
  const notices = {
    findOne: jest.fn(async () => notice),
    update: jest.fn(async (_w: unknown, patch: Partial<Row>) => {
      notice = { ...(notice as Row), ...patch };
    }),
    create: jest.fn((x: Partial<Row>) => x),
    save: jest.fn(async (x: Partial<Row>) => {
      notice = {
        id: 'n1',
        holdUntil: null,
        sentAt: null,
        sentNames: null,
        ...x,
      };
      return notice;
    }),
  };
  const congregations = {
    findOne: jest.fn(async () => ({ id: CONG, timezone: TZ })),
  };
  const weekRules = {
    contextOf: jest.fn(async () => ({
      versions: [
        {
          effectiveFrom: '2020-01-06',
          midweekTime: '19:00',
          weekendTime: '13:00',
        },
      ],
    })),
    rulesFrom: jest.fn((_ctx: unknown, week: string) => ({
      meetings: [{ date: DATES[week], kind: 'midweek' }],
    })),
  };
  const reminders = {
    pendingNotice: jest.fn(async () => ({
      meetingDate: '2026-11-04',
      rows: [
        {
          publisherId: 'p1',
          displayName: 'Ланг Тимо',
          tone: 'assigned',
          label: 'x',
          reach: 'push',
          nextWord: null,
        },
        {
          publisherId: 'p2',
          displayName: 'Кох Никлас',
          tone: 'removed',
          label: 'y',
          reach: 'email',
          nextWord: null,
        },
        {
          publisherId: 'p3',
          displayName: 'Беккер Йонас',
          tone: 'assigned',
          label: 'z',
          reach: 'none',
          nextWord: null,
        },
      ],
      canWait: true,
      nextWord: null,
    })),
  };
  const assignmentsService = {
    notifyChanges: jest.fn(async () => {
      const had = flagged;
      flagged = false;
      return { notified: had ? 1 : 0 };
    }),
  };
  const service = new ProgrammeNoticeService(
    assignments as never,
    notices as never,
    congregations as never,
    weekRules as never,
    reminders as never,
    assignmentsService as never,
  );
  return {
    service,
    assignments,
    assignmentsService,
    notices,
    get notice() {
      return notice;
    },
    use(m: typeof NOV) {
      current = m;
    },
  };
}

describe('dueOf', () => {
  const last = Date.parse('2026-10-21T09:36:00Z');
  it('ten minutes after the last edit', () => {
    expect(
      dueOf({ lastEditMs: last, holdUntilMs: null, minutesToMeeting: 5000 }),
    ).toBe(last + SETTLE_MS);
  });
  it('a minute, when the meeting is less than three hours away', () => {
    expect(
      dueOf({ lastEditMs: last, holdUntilMs: null, minutesToMeeting: 180 }),
    ).toBe(last + SOON_SETTLE_MS);
  });
  it('held for the evening', () => {
    expect(
      dueOf({ lastEditMs: last, holdUntilMs: 42, minutesToMeeting: 5000 }),
    ).toBe(42);
  });
  it('a hold does not survive the meeting coming near', () => {
    expect(
      dueOf({ lastEditMs: last, holdUntilMs: 42, minutesToMeeting: 60 }),
    ).toBe(last + SOON_SETTLE_MS);
  });
});

describe('nextLocalHour', () => {
  it('18:00 Berlin, summer time', () => {
    expect(
      nextLocalHour(new Date('2026-10-21T09:47:13Z'), TZ, 18).toISOString(),
    ).toBe('2026-10-21T16:00:00.000Z');
  });
  it('18:00 Berlin, winter time', () => {
    expect(
      nextLocalHour(new Date('2026-11-02T09:47:00Z'), TZ, 18).toISOString(),
    ).toBe('2026-11-02T17:00:00.000Z');
  });
  it('never earlier than the moment asked', () => {
    expect(
      nextLocalHour(new Date('2026-10-21T16:00:30Z'), TZ, 18).toISOString(),
    ).toBe('2026-10-22T16:00:00.000Z');
  });
});

describe('ProgrammeNoticeService.status', () => {
  it('pending: ten minutes after the last edit, with the evening on offer', async () => {
    const t = make();
    const s = await t.service.status(NOV, new Date('2026-10-21T09:40:00Z'));
    expect(s.state).toBe('pending');
    expect(s.dueAt).toBe('2026-10-21T09:46:00.000Z');
    expect(s.eveningAt).toBe('2026-10-21T16:00:00.000Z');
    expect(s.soon).toBe(false);
    expect(s.rows).toHaveLength(3);
  });

  it('an edit at night goes at 08:00', async () => {
    const t = make({ lastEdit: '2026-10-21T20:00:00Z' });
    const s = await t.service.status(NOV, new Date('2026-10-21T20:01:00Z'));
    expect(s.dueAt).toBe('2026-10-22T06:00:00.000Z');
    expect(s.eveningAt).toBeNull();
  });

  it('the meeting is near: a minute, and no evening', async () => {
    const t = make({ lastEdit: '2026-10-21T15:00:00Z' });
    const s = await t.service.status(TODAY, new Date('2026-10-21T15:00:20Z'));
    expect(s.soon).toBe(true);
    expect(s.dueAt).toBe('2026-10-21T15:01:00.000Z');
    expect(s.eveningAt).toBeNull();
  });

  it('a meeting tonight has no evening before it', async () => {
    const t = make();
    const s = await t.service.status(TODAY, new Date('2026-10-21T08:00:00Z'));
    expect(s.soon).toBe(false);
    expect(s.eveningAt).toBeNull();
  });

  it('no evening on offer after 18:00', async () => {
    const t = make({ lastEdit: '2026-10-21T16:30:00Z' });
    const s = await t.service.status(NOV, new Date('2026-10-21T16:31:00Z'));
    expect(s.eveningAt).toBeNull();
    expect(s.dueAt).toBe('2026-10-21T16:40:00.000Z');
  });

  it('sent today: the line stays until the day is over', async () => {
    const t = make({
      lastEdit: null,
      notice: {
        sentAt: new Date('2026-10-21T09:46:00Z'),
        sentNames: 'Ланг Тимо',
      },
    });
    const s = await t.service.status(NOV, new Date('2026-10-21T15:00:00Z'));
    expect(s.state).toBe('sent');
    expect(s.sentNames).toBe('Ланг Тимо');
    const tomorrow = await t.service.status(
      NOV,
      new Date('2026-10-22T07:00:00Z'),
    );
    expect(tomorrow.state).toBe('none');
    expect(tomorrow.sentAt).toBeNull();
  });
});

describe('ProgrammeNoticeService.later', () => {
  it('holds the change for 18:00', async () => {
    const t = make();
    const s = await t.service.later(NOV, new Date('2026-10-21T09:40:00Z'));
    expect(t.notice?.holdUntil?.toISOString()).toBe('2026-10-21T16:00:00.000Z');
    expect(s.state).toBe('evening');
    expect(s.dueAt).toBe('2026-10-21T16:00:00.000Z');
  });

  it('refuses when the meeting is near', async () => {
    const t = make({ lastEdit: '2026-10-21T15:00:00Z' });
    await expect(
      t.service.later(TODAY, new Date('2026-10-21T15:00:20Z')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.later(TODAY, new Date('2026-10-21T15:00:20Z')),
    ).rejects.toMatchObject({ response: { code: 'NOTICE_NO_EVENING' } });
  });
});

describe('ProgrammeNoticeService.runDue', () => {
  it('waits for the ten minutes', async () => {
    const t = make();
    expect(await t.service.runDue(new Date('2026-10-21T09:45:00Z'))).toBe(0);
    expect(t.assignmentsService.notifyChanges).not.toHaveBeenCalled();
  });

  it('sends when they are over, and remembers to whom', async () => {
    const t = make();
    expect(await t.service.runDue(new Date('2026-10-21T09:46:00Z'))).toBe(1);
    expect(t.assignmentsService.notifyChanges).toHaveBeenCalledWith(
      CONG,
      '2026-11-02',
      'midweek',
    );
    expect(t.notice?.sentAt?.toISOString()).toBe('2026-10-21T09:46:00.000Z');
    // Nobody is named who will hear nothing.
    expect(t.notice?.sentNames).toBe('Ланг Тимо, Кох Никлас');
    // Said once.
    expect(await t.service.runDue(new Date('2026-10-21T09:47:00Z'))).toBe(0);
    expect(t.assignmentsService.notifyChanges).toHaveBeenCalledTimes(1);
  });

  it('keeps an evening hold', async () => {
    const t = make({ notice: { holdUntil: new Date('2026-10-21T16:00:00Z') } });
    expect(await t.service.runDue(new Date('2026-10-21T10:00:00Z'))).toBe(0);
    expect(await t.service.runDue(new Date('2026-10-21T16:00:00Z'))).toBe(1);
    expect(t.notice?.holdUntil).toBeNull();
  });

  it('says nothing at night, and goes in the morning', async () => {
    const t = make({ lastEdit: '2026-10-21T20:00:00Z' });
    expect(await t.service.runDue(new Date('2026-10-21T20:30:00Z'))).toBe(0);
    expect(await t.service.runDue(new Date('2026-10-22T05:59:00Z'))).toBe(0);
    expect(await t.service.runDue(new Date('2026-10-22T06:00:00Z'))).toBe(1);
  });

  it('a minute, when the meeting is near', async () => {
    const t = make({ lastEdit: '2026-10-21T15:00:00Z' });
    t.use(TODAY);
    expect(await t.service.runDue(new Date('2026-10-21T15:00:30Z'))).toBe(0);
    expect(
      await t.service.runDue(
        new Date(Date.parse('2026-10-21T15:00:00Z') + MIN),
      ),
    ).toBe(1);
  });

  it('a meeting that has begun: the marks are put away, nothing is said', async () => {
    const t = make({ lastEdit: '2026-10-21T17:30:00Z' });
    t.use(TODAY);
    expect(await t.service.runDue(new Date('2026-10-21T17:45:00Z'))).toBe(0);
    expect(t.assignmentsService.notifyChanges).not.toHaveBeenCalled();
    expect(t.assignments.update).toHaveBeenCalled();
  });
});
