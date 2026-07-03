import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';

// expo-server-sdk (pulled in via the push service) is ESM-only and breaks
// under Jest — mock the module before the service import resolves it.
jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

import { CleaningRemindersService } from './cleaning-reminders.service';

const CONG = 'cong-1';

function makeSvc(over: Partial<Record<string, any>> = {}) {
  const sends: any[] = [];
  const inserted: { kind: string; key: string }[] = [];

  const push = {
    sendToUsers: jest.fn(
      async (
        t: string,
        users: string[],
        title: string,
        body: string,
        data: any,
      ) => {
        sends.push({ users, title, body, data });
      },
    ),
  };
  // sendToUsers signature is (tenantId, userIds, title, body, data)
  push.sendToUsers = jest.fn(
    async (
      _tenant: string,
      users: string[],
      title: string,
      body: string,
      data: any,
    ) => {
      sends.push({ users, title, body, data });
    },
  );

  const logRepo = {
    insert: jest.fn(async (row: { kind: string; key: string }) => {
      if (inserted.some((r) => r.kind === row.kind && r.key === row.key)) {
        throw new Error('unique violation');
      }
      inserted.push({ kind: row.kind, key: row.key });
    }),
    createQueryBuilder: jest.fn(() => ({
      delete: () => ({
        where: () => ({ execute: async () => ({ affected: 0 }) }),
      }),
    })),
  };

  const svc = new CleaningRemindersService(
    over.congregationRepo ?? ({ find: jest.fn() } as any),
    over.meetingSettingsRepo ?? ({ findOne: jest.fn() } as any),
    over.cleaningRepo ?? ({ find: jest.fn() } as any),
    over.groupRepo ?? ({} as any),
    over.publisherRepo ??
      ({
        find: jest.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }]),
      } as any),
    logRepo as any,
    push as any,
  );
  return { svc, sends, inserted, push, logRepo };
}

describe('CleaningRemindersService.localParts', () => {
  it('converts an instant to Berlin wall-clock (summer, +02:00)', () => {
    // 2026-05-18 is a Monday. 15:00Z = 17:00 Berlin (CEST).
    const p = CleaningRemindersService.localParts(
      new Date('2026-05-18T15:00:00Z'),
      'Europe/Berlin',
    );
    expect(p.date).toBe('2026-05-18');
    expect(p.hour).toBe(17);
    expect(p.isoDow).toBe(1);
    expect(p.minutesOfDay).toBe(17 * 60);
  });

  it('handles winter offset (+01:00)', () => {
    // 2026-01-19 Monday. 15:00Z = 16:00 Berlin (CET).
    const p = CleaningRemindersService.localParts(
      new Date('2026-01-19T15:00:00Z'),
      'Europe/Berlin',
    );
    expect(p.hour).toBe(16);
    expect(p.isoDow).toBe(1);
  });
});

describe('CleaningRemindersService.forCongregation', () => {
  const cong = {
    id: CONG,
    timezone: 'Europe/Berlin',
    language: 'ru',
  } as any;

  const settings = {
    congregationId: CONG,
    midweekDow: 2, // Tuesday 19:00
    midweekTime: '19:00',
    weekendDow: 7, // Sunday 13:00
    weekendTime: '13:00',
  };

  function cleaningRepoWith(rows: any[]) {
    return { find: jest.fn(async () => rows) } as any;
  }

  it('pushes the after-meeting group 2h before the midweek meeting', async () => {
    // Tuesday 2026-05-19, 17:00 Berlin = 15:00Z; 19:00 - 2h = 17:00 → hit.
    const rows = [
      {
        slotType: CleaningSlotType.AFTER_MEETING,
        serviceGroupId: 'g-after',
      },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    await svc['forCongregation'](cong, new Date('2026-05-19T15:00:00Z'));
    expect(sends).toHaveLength(1);
    expect(sends[0].data.type).toBe('cleaning_after_meeting');
    expect(sends[0].data.meeting).toBe('midweek');
    expect(sends[0].users).toEqual(['u1', 'u2']);
  });

  it('does not push the after-meeting group at the wrong time', async () => {
    const rows = [
      { slotType: CleaningSlotType.AFTER_MEETING, serviceGroupId: 'g-after' },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    // Tuesday 14:00 Berlin = 12:00Z — not 17:00.
    await svc['forCongregation'](cong, new Date('2026-05-19T12:00:00Z'));
    expect(sends).toHaveLength(0);
  });

  it('sends the weekly Monday reminder with windows at 09:00 local', async () => {
    const rows = [
      {
        slotType: CleaningSlotType.THOROUGH,
        serviceGroupId: 'g-weekly',
        windows: [4, 5],
        thoroughPlannedAt: null,
      },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    // Monday 2026-05-18, 09:00 Berlin = 07:00Z.
    await svc['forCongregation'](cong, new Date('2026-05-18T07:00:00Z'));
    expect(sends).toHaveLength(1);
    expect(sends[0].data.type).toBe('cleaning_weekly_monday');
    expect(sends[0].body).toContain('4, 5');
  });

  it('sends the optional planned-day reminder 2h before', async () => {
    // Planned Wed 2026-05-20 18:00 Berlin. 2h before = 16:00 Berlin = 14:00Z.
    const rows = [
      {
        slotType: CleaningSlotType.THOROUGH,
        serviceGroupId: 'g-weekly',
        windows: [1],
        thoroughPlannedAt: '2026-05-20T16:00:00.000Z', // 18:00 Berlin
      },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    await svc['forCongregation'](cong, new Date('2026-05-20T14:00:00Z'));
    const planned = sends.filter(
      (s) => s.data.type === 'cleaning_weekly_planned',
    );
    expect(planned).toHaveLength(1);
  });

  it('is idempotent: a second tick in the same window sends nothing', async () => {
    const rows = [
      { slotType: CleaningSlotType.AFTER_MEETING, serviceGroupId: 'g-after' },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    await svc['forCongregation'](cong, new Date('2026-05-19T15:00:00Z'));
    await svc['forCongregation'](cong, new Date('2026-05-19T15:10:00Z'));
    expect(sends).toHaveLength(1);
  });

  it('stays silent during quiet hours', async () => {
    const rows = [
      {
        slotType: CleaningSlotType.THOROUGH,
        serviceGroupId: 'g-weekly',
        windows: [1],
        thoroughPlannedAt: '2026-05-20T21:00:00.000Z', // 23:00 Berlin, quiet
      },
    ];
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith(rows),
    });
    // 21:00 Berlin = 19:00Z — within quiet window start guard at forCongregation.
    await svc['forCongregation'](cong, new Date('2026-05-20T21:00:00Z'));
    expect(sends).toHaveLength(0);
  });

  it('does nothing when no group is assigned', async () => {
    const { svc, sends } = makeSvc({
      meetingSettingsRepo: { findOne: jest.fn(async () => settings) } as any,
      cleaningRepo: cleaningRepoWith([]),
    });
    await svc['forCongregation'](cong, new Date('2026-05-19T15:00:00Z'));
    expect(sends).toHaveLength(0);
  });
});
