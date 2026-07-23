import { BadRequestException } from '@nestjs/common';
import { MeetingAttendanceService } from './meeting-attendance.service';
import { EventType } from '../common/enums/event-type.enum';

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
  return {
    service: new MeetingAttendanceService(
      repo,
      settingsRepo,
      eventsRepo,
      audit,
    ),
    repo,
    audit,
    settingsRepo,
  };
}

describe('MeetingAttendanceService', () => {
  it('divides by the meetings actually held, not by the calendar', async () => {
    // Four midweek meetings fall in the month, but one week was an assembly.
    // Dividing 300 by four would understate every such month.
    const { service } = build([
      row({ date: '2026-09-03', count: 100 }),
      row({ date: '2026-09-10', count: 110 }),
      row({ date: '2026-09-17', count: 90 }),
      row({ date: '2026-09-24', count: null, notHeld: true }),
    ]);

    const year = await service.serviceYear(TENANT, 2026);
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

  it('keeps the two meeting kinds apart', async () => {
    const { service } = build([
      row({ date: '2026-09-03', eventType: EventType.MIDWEEK, count: 100 }),
      row({ date: '2026-09-06', eventType: EventType.WEEKEND, count: 140 }),
    ]);

    const year = await service.serviceYear(TENANT, 2026);

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
      { logCreate: jest.fn(), logUpdate: jest.fn() },
    );

    const out = await svc.pending('cong-1', 2);

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
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
    );

    const out = await svc.pending('cong-1', 4);

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
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
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
      { logCreate: jest.fn(), logUpdate: jest.fn() } as never,
    );

    const out = await svc.pendingForWeek('cong-1', '2026-04-06');

    // The OTHER meeting of that week still happened and is still asked about.
    expect(out.map((m) => m.eventType)).toEqual(['midweek']);
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
