import { BadRequestException, ConflictException } from '@nestjs/common';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { clockStub } from '../common/testing/clock-stub';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * What a field-service meeting may point at, and when it can no longer be
 * changed (9 October 2026).
 *
 * Each case below was seen on the stand before the rule existed: a week that
 * began on a Wednesday was stored, a conductor who does not exist came back as
 * «Internal server error», an assistant who does not exist was stored without
 * a word, and last month's meetings could be created, edited and deleted.
 */

const CONG = 'cong-1';
// Friday 9 October 2026, mid-morning in Berlin.
const NOW = Date.parse('2026-10-09T08:00:00Z');

const MAY_CONDUCT = {
  isActive: true,
  capabilities: { fs_meeting_conductor: true },
};

type Card = { id: string; isActive: boolean; capabilities: object };

function build(
  opts: {
    row?: Record<string, unknown>;
    cards?: Card[];
    groups?: string[];
  } = {},
) {
  const cards = opts.cards ?? [
    { id: 'p-yes', ...MAY_CONDUCT },
    { id: 'p-no', isActive: true, capabilities: {} },
    {
      id: 'p-gone',
      isActive: false,
      capabilities: { fs_meeting_conductor: true },
    },
    { id: 'p-overseer', isActive: true, capabilities: {} },
  ];
  const groups = opts.groups ?? ['g-1'];
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: Record<string, unknown>) => ({ id: 'new', ...v })),
    findOne: jest.fn(async () => (opts.row ? { ...opts.row } : null)),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  const pubRepo = {
    // The tenant is part of the lookup: a card of another congregation is
    // simply not found.
    findOne: jest.fn(async ({ where }: any) =>
      where.congregationId === CONG
        ? (cards.find((c) => c.id === where.id) ?? null)
        : null,
    ),
  };
  const groupsRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.congregationId === CONG && groups.includes(where.id)
        ? { id: where.id, congregationId: CONG }
        : null,
    ),
  };
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  };
  const notify = { notify: jest.fn().mockResolvedValue(undefined) };
  const svc = new FieldServiceMeetingsService(
    repo as any,
    pubRepo as any,
    {} as any,
    notify as any,
    audit as any,
    clockStub(),
    groupsRepo as any,
  );
  return { svc, repo, audit, notify };
}

const base = {
  startTime: '10:30',
  address: 'Hall',
  notifyConductor: false,
};

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => nowSpy.mockRestore());

describe('a field-service meeting — the week', () => {
  it('refuses a week that does not start on a Monday, and stores nothing', async () => {
    const { svc, repo } = build();
    await expect(
      svc.create(CONG, {
        ...base,
        weekStartDate: '2026-11-25', // a Wednesday
        dayOfWeek: 6,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('a field-service meeting already held', () => {
  // Week of 28 September: Saturday 3 October is past; the week of
  // 5 October holds Friday 9 (today) and Thursday 8 (yesterday).
  const held = {
    id: 'm-held',
    congregationId: CONG,
    weekStartDate: '2026-09-28',
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Hall',
    conductorPublisherId: 'p-yes',
    isGeneral: true,
    serviceGroupId: null,
    serviceOverseerVisit: false,
    serviceOverseerPublisherId: null,
    serviceOverseerAssistantId: null,
  };

  it('cannot be created on a day already gone — refused and journaled', async () => {
    const { svc, repo, audit } = build();
    await expect(
      svc.create(CONG, {
        ...base,
        weekStartDate: '2026-10-05',
        dayOfWeek: 4, // Thursday 8 October, yesterday
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DENY',
        entityType: 'field_service_meeting',
        detail: expect.objectContaining({
          reason: 'past_frozen',
          date: '2026-10-08',
        }),
      }),
    );
  });

  it('can still be created for today — the meeting may not have started', async () => {
    const { svc, repo } = build();
    await svc.create(CONG, {
      ...base,
      weekStartDate: '2026-10-05',
      dayOfWeek: 5, // Friday 9 October, today
    } as any);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('cannot be edited', async () => {
    const { svc, repo } = build({ row: held });
    await expect(
      svc.update(CONG, 'm-held', { startTime: '11:00' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('a future meeting cannot be moved onto a day already gone', async () => {
    const { svc, repo } = build({
      row: { ...held, weekStartDate: '2026-10-05', dayOfWeek: 6 }, // Sat 10
    });
    await expect(
      svc.update(CONG, 'm-held', { dayOfWeek: 3 } as any), // Wed 7
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('cannot be deleted — and its conductor is not told «отменена» about a past Saturday', async () => {
    const { svc, repo, notify } = build({ row: held });
    await expect(svc.remove(CONG, 'm-held')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});

describe('a field-service meeting — what it points at', () => {
  const future = { ...base, weekStartDate: '2026-10-12', dayOfWeek: 6 };

  it('is either everyone’s or one group’s, not both', async () => {
    const { svc, repo } = build();
    await expect(
      svc.create(CONG, {
        ...future,
        isGeneral: true,
        serviceGroupId: 'g-1',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('a service overseer’s visit needs a group', async () => {
    const { svc } = build();
    await expect(
      svc.create(CONG, { ...future, serviceOverseerVisit: true } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a group of another congregation', async () => {
    const { svc } = build({ groups: [] });
    await expect(
      svc.create(CONG, { ...future, serviceGroupId: 'g-1' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a conductor who is not a card of this congregation', async () => {
    const { svc } = build();
    await expect(
      svc.create(CONG, {
        ...future,
        conductorPublisherId: 'p-elsewhere',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a conductor whose card switch «Проводит встречу» is off', async () => {
    const { svc } = build();
    await expect(
      svc.create(CONG, { ...future, conductorPublisherId: 'p-no' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a conductor whose card is no longer active', async () => {
    const { svc } = build();
    await expect(
      svc.create(CONG, { ...future, conductorPublisherId: 'p-gone' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a conductor whose switch is on', async () => {
    const { svc, repo } = build();
    await svc.create(CONG, { ...future, conductorPublisherId: 'p-yes' } as any);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('switching a brother off does not lock the meetings he already has', async () => {
    const { svc, repo } = build({
      row: {
        id: 'm-1',
        congregationId: CONG,
        weekStartDate: '2026-10-12',
        dayOfWeek: 6,
        startTime: '10:30',
        address: 'Hall',
        conductorPublisherId: 'p-no', // switched off since he was assigned
        isGeneral: true,
        serviceGroupId: null,
        serviceOverseerVisit: false,
        serviceOverseerPublisherId: null,
        serviceOverseerAssistantId: null,
      },
    });
    // The app sends the whole form back, conductor included.
    await svc.update(CONG, 'm-1', {
      startTime: '11:00',
      conductorPublisherId: 'p-no',
      isGeneral: true,
      serviceGroupId: null,
    } as any);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('the service overseer conducts his own visit whatever his switch says', async () => {
    const { svc, repo } = build();
    await svc.create(CONG, {
      ...future,
      serviceGroupId: 'g-1',
      serviceOverseerVisit: true,
      serviceOverseerPublisherId: 'p-overseer',
      conductorPublisherId: 'p-overseer',
    } as any);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('refuses an assistant who is not a card of this congregation', async () => {
    const { svc, repo } = build();
    await expect(
      svc.create(CONG, {
        ...future,
        serviceGroupId: 'g-1',
        serviceOverseerVisit: true,
        serviceOverseerPublisherId: 'p-overseer',
        serviceOverseerAssistantId: 'p-elsewhere',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
