// The service names the reports service, which reaches the push service and
// the Expo SDK — ESM, untouched by Jest's transform. The usual stand-in.
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
  },
}));

import { MonthlySentService, MONTHLY_KEYS } from './monthly-sent.service';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';
import type { ServiceReportSummary } from './service-reports.service';

const TENANT = 'cong-1';

/** An S-1 for August 2026 with these headline figures. */
function summary(
  active: number,
  inactive = 2,
  studies = 19,
): ServiceReportSummary {
  return {
    reportMonth: '2026-08-01',
    categories: [
      { pioneerType: 'none', count: 70, hours: null, bibleStudies: studies },
      { pioneerType: 'auxiliary', count: 3, hours: 45, bibleStudies: 2 },
      { pioneerType: 'regular', count: 8, hours: 402, bibleStudies: 11 },
      { pioneerType: 'special', count: 0, hours: 0, bibleStudies: 0 },
      { pioneerType: 'missionary', count: 0, hours: 0, bibleStudies: 0 },
    ] as ServiceReportSummary['categories'],
    totalActivePublishers: active,
    totalInactivePublishers: inactive,
    averages: {
      pioneerHours: 0,
      bibleStudies: 0,
      submittedPct: 0,
      activePct: 0,
    },
    closed: true,
  };
}

function setup(
  opts: { stored?: Record<string, unknown> | null; reports?: number } = {},
) {
  let stored: Record<string, unknown> | null = opts.stored ?? null;
  const snapshots = {
    findOne: jest.fn(async () => stored),
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => {
      stored = {
        id: 'snap-1',
        createdAt: new Date('2026-09-19T10:00:00Z'),
        updatedAt: new Date('2026-09-19T10:00:00Z'),
        ...v,
      };
      return stored;
    }),
  };
  const reportsRepo = {
    find: jest.fn(async () => []),
    count: jest.fn(async () => opts.reports ?? 80),
  };
  const publishersRepo = {
    find: jest.fn(async () => [
      {
        id: 'p-late',
        firstName: 'Сергей',
        lastName: 'Новиков',
        appointment: 'publisher',
      },
    ]),
    findOne: jest.fn(async () => ({
      id: 'me',
      firstName: 'Игорь',
      lastName: 'Петров',
    })),
  };
  const auditRepo = { find: jest.fn(async () => []) };
  const congregations = { find: jest.fn(async () => [{ id: TENANT }]) };
  let current = summary(86);
  let currentMembers: Record<string, string[]> = {
    active: ['a', 'b', 'p-late'],
    inactive: ['x', 'y'],
  };
  const reports = {
    computeSummary: jest.fn(async () => ({
      summary: current,
      members: currentMembers,
    })),
  };
  const audit = { logCreate: jest.fn(), logRawUpdate: jest.fn() };
  const service = new MonthlySentService(
    snapshots as never,
    reportsRepo as never,
    publishersRepo as never,
    auditRepo as never,
    congregations as never,
    reports as never,
    audit as never,
    clockStub(),
  );
  return {
    service,
    snapshots,
    audit,
    stored: () => stored,
    setCurrent: (s: ServiceReportSummary, m: Record<string, string[]>) => {
      current = s;
      currentMembers = m;
    },
  };
}

describe('MonthlySentService', () => {
  beforeEach(() => setNow(Date.UTC(2026, 8, 19, 12)));
  afterEach(() => restoreNow());

  it('keeps the month as it stood when it was closed, with whom and when', async () => {
    const { service, stored, audit } = setup();

    await service.saveSent(TENANT, 'user-1', '2026-08-01');

    expect(stored()!.confirmed).toBe(true);
    expect(stored()!.sentOn).toBe('2026-09-19');
    expect((stored()!.figures as Record<string, number>).active).toBe(86);
    expect((stored()!.figures as Record<string, number>).regularHours).toBe(
      402,
    );
    expect((stored()!.members as Record<string, string[]>).active).toEqual([
      'a',
      'b',
      'p-late',
    ]);
    expect(audit.logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'monthly_report',
        actorUserId: 'user-1',
      }),
    );
  });

  it('shows what was sent, not what the reports say a week later', async () => {
    const { service, setCurrent } = setup();
    setCurrent(summary(85, 2, 19), {
      active: ['a', 'b'],
      inactive: ['x', 'y'],
    });
    await service.saveSent(TENANT, 'user-1', '2026-08-01');
    setCurrent(summary(86, 2, 20), {
      active: ['a', 'b', 'p-late'],
      inactive: ['x', 'y'],
    });

    const out = await service.withSent(TENANT, summary(86, 2, 20));

    expect(out.totalActivePublishers).toBe(85);
    expect(out.categories[0].bibleStudies).toBe(19);
    expect(out.drift.map((d) => [d.key, d.sent, d.now])).toEqual([
      ['publishersStudies', 19, 20],
      ['active', 85, 86],
    ]);
    expect(out.drift[1].people).toEqual([
      { id: 'p-late', name: 'Новиков Сергей', change: 'added' },
    ]);
  });

  it('says nothing when nothing has moved', async () => {
    const { service } = setup();
    await service.saveSent(TENANT, 'user-1', '2026-08-01');

    const out = await service.withSent(TENANT, summary(86));

    expect(out.drift).toEqual([]);
    expect(out.sent?.confirmed).toBe(true);
  });

  it('leaves a month nobody kept exactly as the reports say', async () => {
    const { service } = setup();

    const out = await service.withSent(TENANT, summary(86));

    expect(out.sent).toBeNull();
    expect(out.totalActivePublishers).toBe(86);
  });

  it('freezes a month past its deadline that nobody closed, unconfirmed', async () => {
    setNow(Date.UTC(2026, 8, 21, 2));
    const { service, stored, audit } = setup();

    expect(await service.nightly()).toBe(1);
    expect(stored()!.period).toBe('2026-08');
    expect(stored()!.confirmed).toBe(false);
    expect(stored()!.sentOn).toBeNull();
    expect(audit.logCreate).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null }),
    );
  });

  it('never freezes over a month somebody closed', async () => {
    setNow(Date.UTC(2026, 8, 21, 2));
    const { service, snapshots } = setup({
      stored: { id: 'x', confirmed: true, figures: {}, members: {} },
    });

    expect(await service.nightly()).toBe(0);
    expect(snapshots.save).not.toHaveBeenCalled();
  });

  it('does not invent a sheet for a month the congregation never collected', async () => {
    setNow(Date.UTC(2026, 8, 21, 2));
    const { service, snapshots } = setup({ reports: 0 });

    expect(await service.nightly()).toBe(0);
    expect(snapshots.save).not.toHaveBeenCalled();
  });

  it('journals a re-close after a correction as a change', async () => {
    const { service, audit, setCurrent } = setup();
    await service.saveSent(TENANT, 'user-1', '2026-08-01');
    setCurrent(summary(87), { active: ['a'], inactive: [] });

    await service.saveSent(TENANT, 'user-1', '2026-08-01');

    expect(audit.logRawUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: ['active'],
        before: { active: 86 },
        after: { active: 87 },
      }),
    );
  });

  it('names every line of the form', () => {
    expect(MONTHLY_KEYS).toEqual([
      'publishers',
      'publishersStudies',
      'auxiliary',
      'auxiliaryHours',
      'auxiliaryStudies',
      'regular',
      'regularHours',
      'regularStudies',
      'special',
      'specialHours',
      'specialStudies',
      'missionary',
      'missionaryHours',
      'missionaryStudies',
      'active',
      'inactive',
    ]);
  });
});
