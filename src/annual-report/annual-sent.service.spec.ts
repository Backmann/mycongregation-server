import { BadRequestException } from '@nestjs/common';
import { AnnualSentService } from './annual-sent.service';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';
import type { AnnualFigures } from './annual-figures';

const TENANT = 'cong-1';

/** Figures with exactly these people counted as active. */
function figures(active: string[], extra: Partial<AnnualFigures> = {}) {
  return {
    startYear: 2025,
    monthlyReporters: [],
    active: active.map((id) => ({ id, name: id })),
    becameInactive: [],
    reactivated: [],
    inactiveNow: [],
    lapseUnknown: [],
    deaf: [],
    blind: [],
    imprisoned: [],
    ...extra,
  };
}

/**
 * The 2025/26 year as it really went: 85 counted the day before sending, a
 * late August report filed on the very day, 86 now.
 */
function setup(
  opts: { stored?: Record<string, unknown> | null; offered?: string[] } = {},
) {
  let stored: Record<string, unknown> | null = opts.stored ?? null;
  const snapshots = {
    findOne: jest.fn(async () => stored),
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => {
      stored = {
        id: 'snap-1',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        updatedAt: new Date('2026-10-01T10:00:00Z'),
        ...v,
      };
      return stored;
    }),
  };
  const publishers = {
    find: jest.fn(async (q: { where: { id?: { _value: string[] } } }) =>
      (q.where.id?._value ?? ['secretary-card']).map((id: string) => ({
        id,
        firstName: 'Иван',
        lastName: id,
        appointment: 'publisher',
      })),
    ),
    findOne: jest.fn(async () => ({
      id: 'me',
      firstName: 'Пётр',
      lastName: 'Секретарь',
    })),
  };
  const annual = {
    figures: jest.fn(async () => figures(['a', 'b', 'late'])),
    figuresAsOf: jest.fn(async () => ({
      ...figures(['a', 'b']),
      asOf: '2026-09-02',
      unsure: [],
      late: [
        {
          publisherId: 'late',
          kind: 'report_filed',
          at: '2026-09-03T12:07:25.000Z',
          reportMonth: '2026-08-01',
        },
        {
          // Before March: cannot have moved «active».
          publisherId: 'late',
          kind: 'report_filed',
          at: '2026-09-03T12:07:26.000Z',
          reportMonth: '2025-11-01',
        },
      ],
    })),
  };
  const attendance = {
    serviceYear: jest.fn(async () => ({
      startYear: 2025,
      months: [
        { month: '2025-09-01', midweekAverage: 94, weekendAverage: 101 },
        { month: '2025-10-01', midweekAverage: 96, weekendAverage: 103 },
      ],
    })),
  };
  const audit = { logCreate: jest.fn(), logRawUpdate: jest.fn() };
  const congregations = { find: jest.fn(async () => [{ id: TENANT }]) };
  const tasks = {
    create: jest.fn((v: Record<string, unknown>) => v),
    save: jest.fn(async (v: unknown) => v),
    update: jest.fn(),
  };
  const offered = new Set<string>(opts.offered ?? []);
  const taskLog = {
    findOne: jest.fn(async (q: { where: { period: string } }) =>
      offered.has(q.where.period) ? { id: 'log' } : null,
    ),
    create: jest.fn((v: { period: string }) => v),
    save: jest.fn(async (v: { period: string }) => {
      offered.add(v.period);
      return v;
    }),
  };
  const responsibilities = {
    find: jest.fn(async () => [{ userId: 'secretary-user' }]),
  };
  const service = new AnnualSentService(
    snapshots as never,
    publishers as never,
    annual as never,
    attendance as never,
    audit as never,
    clockStub(),
    congregations as never,
    tasks as never,
    taskLog as never,
    responsibilities as never,
  );
  return { service, snapshots, annual, audit, tasks, stored: () => stored };
}

const SENT = {
  active: 85,
  becameInactive: 0,
  reactivated: 0,
  deaf: 0,
  blind: 0,
  imprisoned: 0,
  midweekAverage: 95,
  weekendAverage: 102,
};

describe('AnnualSentService', () => {
  beforeEach(() => setNow(Date.UTC(2026, 9, 1, 12)));
  afterEach(() => restoreNow());

  it('keeps the numbers as typed, not as the app counts them', async () => {
    const { service, stored } = setup();

    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: SENT,
    });

    expect(stored()!.figures).toEqual(SENT);
    expect(stored()!.confirmed).toBe(true);
    expect(stored()!.sentOn).toBe('2026-09-03');
  });

  it('takes the people from the day BEFORE it was sent', async () => {
    // A report filed on the day itself may have come after the form went —
    // so it is left out of the record and named as a difference instead.
    const { service, annual, stored } = setup();

    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: SENT,
    });

    // The first call is the save's own; the view it returns asks again.
    expect(annual.figuresAsOf.mock.calls[0]).toEqual([
      TENANT,
      2025,
      '2026-09-02',
    ]);
    expect((stored()!.members as Record<string, string[]>).active).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps ids and appointments, never names', async () => {
    const { service, stored } = setup();

    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: SENT,
    });

    expect(JSON.stringify(stored()!.members)).not.toContain('Иван');
    expect(stored()!.appointments).toEqual({ a: 'publisher', b: 'publisher' });
  });

  it('names who makes the difference, and why', async () => {
    const { service } = setup();
    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: SENT,
    });

    const view = await service.view(TENANT, 2025);

    const active = view.drift.find((d) => d.key === 'active')!;
    expect(active.sent).toBe(85);
    expect(active.now).toBe(3);
    expect(active.people).toEqual([
      expect.objectContaining({ id: 'late', change: 'added' }),
    ]);
    // Only what can have moved «active»: the August report, not November's.
    expect(active.people[0].reasons.map((r) => r.reportMonth)).toEqual([
      '2026-08-01',
    ]);
  });

  it('says nothing where what was sent and what is now agree', async () => {
    const { service } = setup();
    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: { ...SENT, active: 3 },
    });

    const view = await service.view(TENANT, 2025);

    expect(view.drift.map((d) => d.key)).toEqual([]);
  });

  it('refuses a day inside the year or still ahead', async () => {
    const { service } = setup();

    await expect(
      service.save(TENANT, 'u', 2025, { sentOn: '2026-08-31', figures: SENT }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save(TENANT, 'u', 2025, { sentOn: '2026-10-02', figures: SENT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a figure that is not a whole number', async () => {
    const { service } = setup();

    await expect(
      service.save(TENANT, 'u', 2025, {
        sentOn: '2026-09-03',
        figures: { ...SENT, active: 8.5 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('journals the first save as created and a correction as changed', async () => {
    const { service, audit } = setup();
    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: SENT,
    });
    expect(audit.logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'annual_report',
        after: expect.objectContaining({ active: 85, sentOn: '2026-09-03' }),
      }),
    );

    await service.save(TENANT, 'user-1', 2025, {
      sentOn: '2026-09-03',
      figures: { ...SENT, active: 86 },
    });
    expect(audit.logRawUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFields: ['active'],
        before: { active: 85 },
        after: { active: 86 },
      }),
    );
  });

  it('works the attendance averages out as the screen does', async () => {
    const { service } = setup();

    const view = await service.view(TENANT, 2025);

    expect(view.now.midweekAverage).toBe(95);
    expect(view.now.weekendAverage).toBe(102);
  });

  describe('freezeIfDue', () => {
    it('does nothing up to and including 20 September', async () => {
      setNow(Date.UTC(2026, 8, 20, 12));
      const { service, snapshots } = setup();

      expect(await service.freezeIfDue(TENANT, 2025)).toBe(false);
      expect(snapshots.save).not.toHaveBeenCalled();
    });

    it('keeps the app’s own figures, unconfirmed, the day after', async () => {
      setNow(Date.UTC(2026, 8, 21, 12));
      const { service, stored, audit } = setup();

      expect(await service.freezeIfDue(TENANT, 2025)).toBe(true);
      expect(stored()!.confirmed).toBe(false);
      expect(stored()!.sentOn).toBeNull();
      expect((stored()!.figures as Record<string, number>).active).toBe(3);
      expect(audit.logCreate).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null }),
      );
    });

    it('never overwrites what somebody saved', async () => {
      setNow(Date.UTC(2026, 9, 25, 12));
      const { service, snapshots } = setup({
        stored: { id: 'x', confirmed: true, figures: SENT, members: {} },
      });

      expect(await service.freezeIfDue(TENANT, 2025)).toBe(false);
      expect(snapshots.save).not.toHaveBeenCalled();
    });
  });

  describe('the September task', () => {
    it('puts «save what was sent» on the secretary’s list', async () => {
      setNow(Date.UTC(2026, 8, 1, 12));
      const { service, tasks } = setup();

      await service.nightly();

      expect(tasks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'annual_report_sent',
          kindPeriod: '2026',
          dueDate: '2026-09-20',
          assignees: [expect.objectContaining({ id: 'secretary-card' })],
        }),
      );
    });

    it('offers it once a year, even when deleted', async () => {
      setNow(Date.UTC(2026, 8, 2, 12));
      const { service, tasks } = setup({ offered: ['2026'] });

      await service.nightly();

      expect(tasks.save).not.toHaveBeenCalled();
    });

    it('does not ask for what is already saved', async () => {
      setNow(Date.UTC(2026, 8, 5, 12));
      const { service, tasks } = setup({
        stored: { id: 'x', confirmed: true, figures: SENT, members: {} },
      });

      await service.nightly();

      expect(tasks.save).not.toHaveBeenCalled();
    });

    it('is not raised in the spring', async () => {
      setNow(Date.UTC(2026, 3, 5, 12));
      const { service, tasks } = setup();

      await service.nightly();

      expect(tasks.save).not.toHaveBeenCalled();
    });

    it('is closed by saving, in the saver’s name', async () => {
      const { service, tasks } = setup();

      await service.save(TENANT, 'user-1', 2025, {
        sentOn: '2026-09-03',
        figures: SENT,
      });

      expect(tasks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'annual_report_sent',
          kindPeriod: '2026',
          status: 'open',
        }),
        expect.objectContaining({ status: 'done', doneById: 'user-1' }),
      );
    });

    it('is due on 20 September — the annual report is filed by then', async () => {
      setNow(Date.UTC(2026, 8, 1, 12));
      const { service, tasks } = setup();

      await service.nightly();

      expect(tasks.save.mock.calls[0][0]).toEqual(
        expect.objectContaining({ dueDate: '2026-09-20' }),
      );
    });

    it('is not raised after 20 September', async () => {
      setNow(Date.UTC(2026, 8, 21, 12));
      const { service, tasks } = setup();

      await service.nightly();

      expect(tasks.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'annual_report_sent' }),
      );
    });

    it('moves its own open task to the rule’s date, never a person’s', async () => {
      setNow(Date.UTC(2026, 9, 2, 12));
      const { service, tasks } = setup();

      await service.nightly();

      const [where, change] = tasks.update.mock.calls[0];
      expect(where).toEqual(
        expect.objectContaining({
          kind: 'annual_report_sent',
          kindPeriod: '2026',
          status: 'open',
        }),
      );
      // Only what the app raised: createdById IS NULL.
      expect(where.createdById).toBeDefined();
      expect(change).toEqual({ dueDate: '2026-09-20' });
    });
  });
});
