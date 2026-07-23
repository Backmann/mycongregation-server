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
  return { service: new MeetingAttendanceService(repo, audit), repo, audit };
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
