import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { EventType } from '../common/enums/event-type.enum';
import { clockStub } from '../common/testing/clock-stub';

/**
 * The attendance rules added on 31 October 2026 — what the server refuses,
 * the year's line worked out in one place, the closed year's debt until the
 * S-10 is due, and the hour of a meeting moved by an event.
 */
const T = 'cong-1';
// Thursday midweek at 19:00, Sunday weekend at 10:00.
const SETTINGS = [
  {
    effectiveFrom: '2020-01-01',
    midweekDow: 4,
    weekendDow: 7,
    midweekTime: '19:00',
    weekendTime: '10:00',
  },
];

function saved(p: Record<string, unknown>) {
  return {
    id: 'a1',
    congregationId: T,
    eventType: EventType.MIDWEEK,
    count: 100,
    onlineCount: null,
    notHeld: false,
    notHeldReason: null,
    note: null,
    recordedBy: 'u-1',
    createdAt: new Date('2026-09-03T20:00:00Z'),
    updatedAt: new Date('2026-09-03T20:00:00Z'),
    ...p,
  };
}

function build(opts: {
  rows?: Record<string, unknown>[];
  existing?: Record<string, unknown> | null;
  events?: (where: unknown) => unknown[];
  settings?: unknown[];
}) {
  const rows = opts.rows ?? [];
  const repo = {
    find: jest.fn(async (q: { where: { date?: unknown } }) => {
      const d = q.where?.date as { _type?: string; _value?: unknown } | string;
      if (typeof d === 'string') return rows.filter((r) => r.date === d);
      return rows;
    }),
    findOne: jest.fn(async (q: { where: { date: string } }) =>
      opts.existing === undefined
        ? (rows.find((r) => r.date === q.where.date) ?? null)
        : opts.existing,
    ),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: Record<string, unknown>) => ({
      id: 'a1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...x,
    })),
    delete: jest.fn(),
  };
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  };
  const settingsRepo = {
    find: jest.fn().mockResolvedValue(opts.settings ?? SETTINGS),
  };
  const eventsRepo = {
    find: jest.fn(async (q: { where: unknown }) =>
      opts.events ? opts.events(q.where) : [],
    ),
  };
  const publishersRepo = {
    find: jest
      .fn()
      .mockResolvedValue([
        { userId: 'u-1', lastName: 'Келлер', firstName: 'Давид' },
      ]),
  };
  const service = new MeetingAttendanceService(
    repo as never,
    settingsRepo as never,
    eventsRepo as never,
    publishersRepo as never,
    audit as never,
    clockStub(),
  );
  return { service, repo, audit };
}

afterEach(() => jest.useRealTimers());
const at = (iso: string) => jest.useFakeTimers().setSystemTime(new Date(iso));

describe('recording — what the server refuses', () => {
  it('those by video are part of the figure, never more than it', async () => {
    const { service } = build({ existing: null });
    await expect(
      service.record(
        T,
        {
          date: '2026-10-01',
          eventType: EventType.MIDWEEK,
          count: 90,
          onlineCount: 91,
        },
        'u-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a meeting still ahead has nobody to count', async () => {
    at('2026-10-31T09:00:00Z');
    const { service } = build({ existing: null });
    await expect(
      service.record(
        T,
        { date: '2026-11-05', eventType: EventType.MIDWEEK, count: 90 },
        'u-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'ATTENDANCE_FUTURE' } });
  });

  it('a day with no meeting of that kind has nothing to count at', async () => {
    at('2026-10-31T09:00:00Z');
    const { service } = build({ existing: null });
    // 26 October 2026 is a Monday.
    await expect(
      service.record(
        T,
        { date: '2026-10-26', eventType: EventType.MIDWEEK, count: 90 },
        'u-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'ATTENDANCE_NOT_A_MEETING' } });
  });

  it('a figure already standing off the usual days may still be corrected', async () => {
    at('2026-10-31T09:00:00Z');
    const { service, repo } = build({
      existing: saved({ date: '2026-10-27', count: 80 }),
    });
    await service.record(
      T,
      { date: '2026-10-27', eventType: EventType.MIDWEEK, count: 82 },
      'u-1',
    );
    expect(repo.save).toHaveBeenCalled();
  });

  it('the second of two at once is told who was first, not written over', async () => {
    at('2026-10-31T09:00:00Z');
    const { service, repo } = build({
      existing: saved({ date: '2026-10-29', count: 96 }),
    });
    const err = await service
      .record(
        T,
        {
          date: '2026-10-29',
          eventType: EventType.MIDWEEK,
          count: 97,
          expectNew: true,
        },
        'u-2',
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'ATTENDANCE_ALREADY_RECORDED',
      current: { count: 96, recordedByName: 'Келлер Давид' },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('…and so is one correcting a figure that changed under him', async () => {
    at('2026-10-31T09:00:00Z');
    const { service } = build({
      existing: saved({
        date: '2026-10-29',
        updatedAt: new Date('2026-10-29T19:40:00Z'),
      }),
    });
    await expect(
      service.record(
        T,
        {
          date: '2026-10-29',
          eventType: EventType.MIDWEEK,
          count: 97,
          expectedRecordedAt: '2026-10-29T19:30:00.000Z',
        },
        'u-2',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('saving the same thing again changes nothing and journals nothing', async () => {
    at('2026-10-31T09:00:00Z');
    const { service, repo, audit } = build({
      existing: saved({ date: '2026-10-29', count: 96 }),
    });
    await service.record(
      T,
      { date: '2026-10-29', eventType: EventType.MIDWEEK, count: 96 },
      'u-2',
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.logUpdate).not.toHaveBeenCalled();
  });

  it('keeps the reason a meeting was not held, and no figure with it', async () => {
    at('2026-10-31T09:00:00Z');
    const { service, repo } = build({ existing: null });
    await service.record(
      T,
      {
        date: '2026-10-29',
        eventType: EventType.MIDWEEK,
        notHeld: true,
        notHeldReason: 'weather',
        onlineCount: 5,
      },
      'u-1',
    );
    const row = repo.save.mock.calls[0][0];
    expect(row).toMatchObject({
      notHeld: true,
      notHeldReason: 'weather',
      count: null,
      onlineCount: null,
    });
  });
});

describe('taking away and moving a figure', () => {
  it('takes it away and journals what it was', async () => {
    const { service, repo, audit } = build({
      existing: saved({ date: '2026-10-27' }),
    });
    await service.remove(T, {
      date: '2026-10-27',
      eventType: EventType.MIDWEEK,
    });
    expect(repo.delete).toHaveBeenCalledWith({ id: 'a1' });
    expect(audit.logEvent.mock.calls[0][0]).toMatchObject({
      action: 'DELETE',
      detail: { date: '2026-10-27', count: 100 },
    });
  });

  it('says there is nothing to take away', async () => {
    const { service } = build({ existing: null });
    await expect(
      service.remove(T, { date: '2026-10-27', eventType: EventType.MIDWEEK }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moves it onto the meeting of that week that has none', async () => {
    at('2026-10-31T09:00:00Z');
    const row = saved({ date: '2026-10-27' });
    const { service, repo } = build({
      rows: [row],
      existing: undefined,
    });
    repo.findOne.mockImplementation(async (q: { where: { date: string } }) =>
      q.where.date === '2026-10-27' ? row : null,
    );
    const out = await service.move(T, {
      date: '2026-10-27',
      eventType: EventType.MIDWEEK,
      toDate: '2026-10-29',
    });
    expect(out.date).toBe('2026-10-29');
  });

  it('will not move it onto a meeting that has its own', async () => {
    at('2026-10-31T09:00:00Z');
    const { service } = build({ existing: saved({ date: '2026-10-29' }) });
    await expect(
      service.move(T, {
        date: '2026-10-27',
        eventType: EventType.MIDWEEK,
        toDate: '2026-10-29',
      }),
    ).rejects.toMatchObject({ response: { code: 'ATTENDANCE_MOVE_TARGET' } });
  });
});

describe('the year’s line, counted in one place', () => {
  it('averages the months that hold one, says how many, and names the holes', async () => {
    at('2026-10-31T09:00:00Z');
    const rows = [
      // September: four Thursdays counted (3, 10, 17, 24).
      ...['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'].map((d) =>
        saved({ date: d, count: 90, onlineCount: 10 }),
      ),
      // October: 1, 8, 15 counted; 22 and 29 not entered.
      ...['2026-10-01', '2026-10-08', '2026-10-15'].map((d) =>
        saved({ date: d, count: 100 }),
      ),
    ];
    const { service } = build({ rows });
    const y = await service.serviceYear(T, 2026);
    expect(y.yearly.midweekAverage).toBe(95);
    expect(y.yearly.midweekMonths).toBe(2);
    expect(y.yearly.midweekOnlineAverage).toBe(10);
    expect(y.months[1].midweekMissing).toBe(2);
    expect(y.months[0].midweekMissing).toBe(0);
    expect(y.gaps.filter((g) => g.eventType === EventType.MIDWEEK)).toEqual([
      { date: '2026-10-22', eventType: EventType.MIDWEEK },
      { date: '2026-10-29', eventType: EventType.MIDWEEK },
    ]);
    // Twelve months, but dividing by twelve would have said 16.
    expect(y.months).toHaveLength(12);
  });

  it('refuses a year that cannot be one', async () => {
    const { service } = build({});
    await expect(service.serviceYear(T, Number('abc'))).rejects.toMatchObject({
      response: { code: 'ATTENDANCE_YEAR_INVALID' },
    });
  });
});

describe('Home', () => {
  it('keeps the closed year’s holes in view until 20 September', async () => {
    at('2027-09-10T09:00:00Z');
    const { service } = build({ rows: [] });
    const p = await service.pending(T);
    expect(p.outstandingPreviousYear).toBeGreaterThan(90);
    expect(p.outstandingThisYear).toBeGreaterThan(p.outstandingPreviousYear);
    expect(p.gaps.length).toBeLessThanOrEqual(6);
  });

  it('and lets them go after it', async () => {
    at('2027-09-21T09:00:00Z');
    const { service } = build({ rows: [] });
    const p = await service.pending(T);
    expect(p.outstandingPreviousYear).toBe(0);
  });

  it('opens by the hour an event gave the meeting, not the usual one', async () => {
    // Thursday 29 October 2026, a meeting «with changes» at 10:00. At 09:15
    // Berlin time the card is open — by the usual 19:00 it would not be.
    at('2026-10-29T08:15:00Z');
    const events = (where: unknown) =>
      (where as { meetingMode?: string }).meetingMode === 'changed'
        ? [{ date: '2026-10-29', endDate: null, meetingTime: '10:00' }]
        : [];
    const withEvent = await build({ events }).service.pending(T);
    expect(withEvent.meetings).toEqual([
      { date: '2026-10-29', eventType: EventType.MIDWEEK },
    ]);
    const without = await build({}).service.pending(T);
    expect(without.meetings).toEqual([]);
  });

  it('shows what was entered today, so a slip is put right on the spot', async () => {
    at('2026-10-29T19:30:00Z');
    const { service } = build({
      rows: [saved({ date: '2026-10-29', count: 96, onlineCount: 12 })],
    });
    const p = await service.pending(T);
    expect(p.meetings).toEqual([]);
    expect(p.recordedToday).toEqual([
      expect.objectContaining({
        date: '2026-10-29',
        count: 96,
        onlineCount: 12,
        recordedByName: 'Келлер Давид',
      }),
    ]);
  });
});
