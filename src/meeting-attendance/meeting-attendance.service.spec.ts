import { BadRequestException } from '@nestjs/common';
import {
  MeetingAttendanceService,
  attendanceOpen,
  minutesOfClock,
} from './meeting-attendance.service';
import { EventType } from '../common/enums/event-type.enum';
import { clockStub } from '../common/testing/clock-stub';

const TENANT = 'cong-1';

function row(partial: Record<string, unknown>) {
  return {
    id: 'a1',
    congregationId: TENANT,
    date: '2026-09-03',
    eventType: EventType.MIDWEEK,
    count: 100,
    notHeld: false,
    note: null,
    recordedBy: null,
    createdAt: new Date('2025-09-05T10:00:00Z'),
    updatedAt: new Date('2025-09-05T10:00:00Z'),
    ...partial,
  } as never;
}

function build(rows: unknown[] = []) {
  const repo = {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: Record<string, unknown>) => ({ id: 'a1', ...x })),
  } as never;
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  } as never;
  const settingsRepo = { find: jest.fn().mockResolvedValue([]) } as never;
  const eventsRepo = { find: jest.fn().mockResolvedValue([]) } as never;
  const publishersRepo = { find: jest.fn().mockResolvedValue([]) } as never;
  return {
    service: new MeetingAttendanceService(
      repo,
      settingsRepo,
      eventsRepo,
      publishersRepo,
      audit,
      clockStub(),
    ),
    repo,
    audit,
    settingsRepo,
    publishersRepo,
  };
}

describe('MeetingAttendanceService', () => {
  it('divides by the meetings actually held, not by the calendar', async () => {
    // Four midweek meetings fall in the month, but one week the congregation
    // was at an assembly. Dividing 300 by four would understate every such
    // month. A past service year, because meetings still ahead are not listed.
    const { service, settingsRepo } = build([
      row({ date: '2025-09-04', count: 100 }),
      row({ date: '2025-09-11', count: 110 }),
      row({ date: '2025-09-18', count: 90 }),
      row({ date: '2025-09-25', count: null, notHeld: true }),
    ]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);

    const year = await service.serviceYear(TENANT, 2025);
    const september = year.months[0];

    expect(september.midweekTotal).toBe(300);
    expect(september.midweekAverage).toBe(100);
  });

  it('leaves the average empty rather than showing zero when nothing is recorded', async () => {
    const { service } = build([]);

    const year = await service.serviceYear(TENANT, 2026);

    // Zero would read as "nobody came"; empty reads as "not counted yet".
    expect(year.months[0].midweekAverage).toBeNull();
    expect(year.months[0].midweekTotal).toBe(0);
  });

  it('runs the service year from September to August', async () => {
    const { service, repo } = build([]);

    const year = await service.serviceYear(TENANT, 2026);

    expect(year.months).toHaveLength(12);
    expect(year.months[0].month).toBe('2026-09-01');
    expect(year.months[11].month).toBe('2027-08-01');
    const where = (repo as unknown as { find: jest.Mock }).find.mock.calls[0][0]
      .where;
    expect(where.congregationId).toBe(TENANT);
  });

  it('shows a week nobody entered as a hole, not as nothing at all', async () => {
    // The sheet lists the year's MEETINGS, not its records. A missing week
    // that simply vanishes from the list cannot be noticed, and noticing is
    // the whole point of reading the sheet before handing it over.
    const { service, settingsRepo } = build([
      row({ date: '2025-09-04', count: 100 }),
      // 11 September deliberately absent
      row({ date: '2025-09-18', count: 90 }),
    ]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);

    const year = await service.serviceYear(TENANT, 2025);
    const midweek = year.months[0].midweek;

    const gap = midweek.find((m) => m.date === '2025-09-11');
    expect(gap).toBeDefined();
    expect(gap?.recorded).toBe(false);
    // And it takes no part in the average, which counts only what was counted.
    expect(year.months[0].midweekAverage).toBe(95);
  });

  it('signs a figure with who entered it and marks a later correction', async () => {
    // A sheet handed to the circuit overseer should carry its own account of
    // itself. A correction is proper and expected — but it should say so on
    // the face of the sheet, not only in the journal.
    const { service, settingsRepo, publishersRepo } = build([
      row({
        date: '2025-09-04',
        count: 100,
        recordedBy: 'user-1',
        createdAt: new Date('2025-09-04T20:00:00Z'),
        updatedAt: new Date('2025-09-04T20:00:00Z'),
      }),
      row({
        date: '2025-09-11',
        count: 96,
        recordedBy: 'user-1',
        createdAt: new Date('2025-09-11T20:00:00Z'),
        updatedAt: new Date('2025-09-13T09:15:00Z'),
      }),
    ]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    (publishersRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { userId: 'user-1', firstName: 'Лионель', lastName: 'Бакманн' },
    ]);

    const year = await service.serviceYear(TENANT, 2025);
    const midweek = year.months[0].midweek;

    const first = midweek.find((m) => m.date === '2025-09-04');
    expect(first?.recordedByName).toBe('Бакманн Лионель');
    expect(first?.corrected).toBe(false);

    const revised = midweek.find((m) => m.date === '2025-09-11');
    expect(revised?.corrected).toBe(true);
    expect(revised?.recordedAt).toBe('2025-09-13T09:15:00.000Z');
  });

  it('keeps the two meeting kinds apart', async () => {
    const { service, settingsRepo } = build([
      row({ date: '2025-09-04', eventType: EventType.MIDWEEK, count: 100 }),
      row({ date: '2025-09-07', eventType: EventType.WEEKEND, count: 140 }),
    ]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);

    const year = await service.serviceYear(TENANT, 2025);

    expect(year.months[0].midweekTotal).toBe(100);
    expect(year.months[0].weekendTotal).toBe(140);
  });

  it('follows the circuit visit when it moves the midweek meeting', async () => {
    // The visit shifts the midweek meeting to another weekday. Offering the
    // usual day would invite a figure filed against a meeting that never
    // happened then.
    const { service, settingsRepo, repo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn().mockResolvedValue([
      {
        type: 'circuit_overseer_visit',
        date: '2026-07-20',
        endDate: '2026-07-26',
        coMidweekDow: 2,
      },
    ]);
    // Rebuild with the visit in place.
    const svc = new (service.constructor as new (
      ...a: unknown[]
    ) => typeof service)(
      repo,
      settingsRepo,
      { find: eventsFind },
      // The publishers repository was missing here entirely, so the audit
      // service was landing in its slot — harmless on this path, and exactly
      // the sort of thing that stops being harmless later.
      { find: jest.fn().mockResolvedValue([]) },
      { logCreate: jest.fn(), logUpdate: jest.fn() },
      clockStub(),
    );

    const out = (await svc.pending('cong-1', 2)).meetings;

    // Whatever it offers for that week's midweek meeting, it must not be the
    // ordinary Thursday.
    const thatWeek = out.filter(
      (m) => m.date >= '2026-07-20' && m.date <= '2026-07-26',
    );
    for (const m of thatWeek) {
      if (m.eventType === 'midweek') expect(m.date).not.toBe('2026-07-23');
    }
  });

  it('does not ask about a meeting an assembly replaced', async () => {
    // The congregation was at a convention; there was no meeting to count, and
    // nagging for a figure would invite a wrong one.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      const types = Array.isArray(where)
        ? (where as { type: string }[]).map((w) => w.type)
        : [(where as { type: string }).type];
      // The circuit-visit lookup gets nothing; the cancelling one gets the
      // convention that covered the whole week.
      if (types.includes('regional_convention')) {
        return [{ date: '2026-07-01', endDate: '2027-08-31' }];
      }
      return [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = (await svc.pending('cong-1', 4)).meetings;

    expect(out).toHaveLength(0);
  });

  it('lets the Memorial take the midweek meeting when it falls on a weekday', async () => {
    // Nisan 14 lands on a Wednesday; the midweek meeting gives way, and it is
    // the midweek one even though the meeting itself is a Thursday.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      const type = Array.isArray(where) ? '' : (where as { type: string }).type;
      // Wednesday, inside the week beginning Monday 2026-04-06.
      return type === 'memorial' ? [{ date: '2026-04-08', endDate: null }] : [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    expect(out.map((m) => m.eventType)).toEqual(['weekend']);
  });

  it('lets the Memorial take the weekend meeting when it falls at the weekend', async () => {
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      const type = Array.isArray(where) ? '' : (where as { type: string }).type;
      // Saturday of the same week.
      return type === 'memorial' ? [{ date: '2026-04-11', endDate: null }] : [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    // The OTHER meeting of that week still happened and is still asked about.
    expect(out.map((m) => m.eventType)).toEqual(['midweek']);
  });

  it('counts what is outstanding for the whole year, not just the weeks it offers', async () => {
    // The card offers a recent meeting, but the count beside it has to be
    // honest about the year: a meeting missed in October is still a hole in
    // the sheet in July, and a count that stopped at eight weeks understated
    // precisely the thing it existed to surface.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    // Nothing recorded at all, and only two weeks are offered.
    const out = await svc.pending('cong-1', 2);

    expect(out.meetings.length).toBeLessThanOrEqual(4);
    // Many weeks have passed since 1 September, so the year's tally is far
    // larger than the handful the card offers.
    expect(out.outstandingThisYear).toBeGreaterThan(out.meetings.length);
  });

  it('refuses a held meeting with no figure', async () => {
    const { service } = build();

    await expect(
      service.record(
        TENANT,
        { date: '2026-09-03', eventType: EventType.MIDWEEK },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores no figure for a meeting that was not held', async () => {
    const { service, repo } = build();

    await service.record(
      TENANT,
      { date: '2026-09-24', eventType: EventType.MIDWEEK, notHeld: true },
      'user-1',
    );

    const saved = (repo as unknown as { save: jest.Mock }).save.mock
      .calls[0][0];
    expect(saved.notHeld).toBe(true);
    expect(saved.count).toBeNull();
  });

  it('corrects the existing figure instead of adding a second one', async () => {
    // A second row for the same meeting would quietly double the month.
    const { service, repo } = build();
    (repo as unknown as { findOne: jest.Mock }).findOne.mockResolvedValue(
      row({ count: 100 }),
    );

    await service.record(
      TENANT,
      { date: '2026-09-03', eventType: EventType.MIDWEEK, count: 105 },
      'user-1',
    );

    expect(
      (repo as unknown as { create: jest.Mock }).create,
    ).not.toHaveBeenCalled();
    const saved = (repo as unknown as { save: jest.Mock }).save.mock
      .calls[0][0];
    expect(saved.count).toBe(105);
  });

  it('records a correction in the journal, since a report must not change quietly', async () => {
    const { service, repo, audit } = build();
    (repo as unknown as { findOne: jest.Mock }).findOne.mockResolvedValue(
      row({ count: 100 }),
    );

    await service.record(
      TENANT,
      { date: '2026-09-03', eventType: EventType.MIDWEEK, count: 105 },
      'user-1',
    );

    const call = (audit as unknown as { logUpdate: jest.Mock }).logUpdate.mock
      .calls[0][0];
    expect(call.before.count).toBe(100);
    expect(call.after.count).toBe(105);
  });
});

describe('attendanceOpen — when the card may be filled in', () => {
  const TODAY = '2026-07-29'; // a Wednesday
  const START = '19:00'; // 1140 minutes

  it('opens an hour before the meeting starts', () => {
    expect(attendanceOpen(TODAY, START, TODAY, 18 * 60)).toBe(true);
  });

  it('stays shut earlier in the day', () => {
    expect(attendanceOpen(TODAY, START, TODAY, 17 * 60 + 59)).toBe(false);
  });

  // THE POINT OF THE RULE. A meeting whose day has passed is closed on the
  // card. It used to stay open so a forgotten week could still be fixed from
  // home, and that is exactly what let a midweek meeting sit there until the
  // weekend one arrived — at which point the weekend figure could be typed
  // into the midweek row, a valid entry about the wrong meeting. Missed
  // meetings are recovered on the attendance page, where each carries its own
  // date and kind.
  it('is shut for a meeting on an earlier day', () => {
    expect(attendanceOpen('2026-07-22', START, TODAY, 8 * 60)).toBe(false);
  });

  it('is shut for a meeting still to come', () => {
    expect(attendanceOpen('2026-08-05', START, TODAY, 23 * 60)).toBe(false);
  });

  // Without a time on record the card takes the whole of the meeting's day:
  // later days are closed now, so a congregation that has not set its meeting
  // times would otherwise never see it at all.
  it('takes the whole day when no time is recorded', () => {
    expect(attendanceOpen(TODAY, null, TODAY, 8 * 60)).toBe(true);
    expect(attendanceOpen('2026-07-22', null, TODAY, 8 * 60)).toBe(false);
  });

  // The backlog does not disappear with the card — it is counted separately
  // and shown as «Ещё N без записи», which is what leads to the page.
  it('closing the card says nothing about the backlog', () => {
    expect(attendanceOpen('2026-07-22', START, TODAY, 23 * 60)).toBe(false);
  });

  it('reads a time with seconds as well', () => {
    expect(minutesOfClock('10:30:00')).toBe(630);
    expect(minutesOfClock(null)).toBeNull();
  });
});

describe('a convention week asks for nothing — the case the old rule got wrong', () => {
  it('does not ask about the midweek meeting when a Friday-to-Sunday convention leaves its day uncovered', async () => {
    // The convention runs 10–12 April; the midweek meeting is the Thursday
    // before it, the 9th. The congregation holds no meetings that week at all,
    // so neither figure is wanted. The old rule asked whether the event
    // covered the MEETING'S date, kept the Thursday, and put it in front of
    // the secretary as an outstanding entry.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      const types = Array.isArray(where)
        ? (where as { type: string }[]).map((w) => w.type)
        : [(where as { type: string }).type];
      if (types.includes('regional_convention')) {
        return [{ date: '2026-04-10', endDate: '2026-04-12' }];
      }
      return [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    expect(out).toEqual([]);
  });

  it('does not ask about either meeting when a one-day assembly falls on the Saturday', async () => {
    // Saturday 11 April covers neither the Thursday nor the Sunday, so the old
    // rule kept BOTH meetings.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      const types = Array.isArray(where)
        ? (where as { type: string }[]).map((w) => w.type)
        : [(where as { type: string }).type];
      if (types.includes('regional_convention')) {
        return [
          { date: '2026-04-11', endDate: null, type: 'circuit_assembly' },
        ];
      }
      return [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    expect(out).toEqual([]);
  });
});

describe('an event flagged «в этот день обычной встречи нет»', () => {
  it('is obeyed by the server too, not only on screen', async () => {
    // The switch has been on the event form all along and the app has always
    // hidden the meeting for it; the server read the column nowhere, so it
    // still asked the secretary to record attendance at that meeting.
    const { repo, settingsRepo } = build([]);
    (settingsRepo as unknown as { find: jest.Mock }).find.mockResolvedValue([
      { effectiveFrom: '2020-01-01', midweekDow: 4, weekendDow: 7 },
    ]);
    const eventsFind = jest.fn(async (opts: unknown) => {
      const where = (opts as { where: unknown }).where;
      if (
        !Array.isArray(where) &&
        (where as { replacesMeeting?: boolean }).replacesMeeting
      ) {
        // Special talk on the Thursday — the midweek meeting's own day.
        return [{ type: 'special_talk', date: '2026-04-09', endDate: null }];
      }
      return [];
    });
    const svc = new MeetingAttendanceService(
      repo,
      settingsRepo,
      { find: eventsFind } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    expect(out.map((m) => m.eventType)).toEqual(['weekend']);
  });
});
