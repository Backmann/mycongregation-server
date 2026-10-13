import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { clockStub } from '../common/testing/clock-stub';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * Moving a meeting to another week, cancelling it and bringing it back
 * (13 October 2026).
 *
 * A meeting moved by a week used to be deleted and made again. Now the week
 * is editable, the meeting stays the same record, and a move of the day, the
 * hour or the place is told to everyone going — those assigned as their own
 * assignment, the group or congregation as ministry news (`field_service_change`). A cancelled
 * meeting stays in sight, crossed out with its reason; it is sent only to an
 * app that asks for it, books nobody, and is never reminded.
 */

const CONG = 'cong-1';
// Friday 9 October 2026, mid-morning in Berlin.
const NOW = Date.parse('2026-10-09T08:00:00Z');

const CARD = {
  isActive: true,
  capabilities: { fs_meeting_conductor: true },
};

type Row = Record<string, unknown> & { id: string };

function build(rows: Row[] = []) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
  };
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: Record<string, unknown>) => ({
      id: 'new',
      ...v,
    })),
    findOne: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    }),
    delete: jest.fn(async () => ({ affected: 1 })),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
  };
  // Two in group g-1, one in g-2, one with no login at all.
  const cards: Record<string, unknown>[] = [
    { id: 'p-a', userId: 'u-a', serviceGroupId: 'g-1', ...CARD },
    { id: 'p-b', userId: 'u-b', serviceGroupId: 'g-1', ...CARD },
    { id: 'p-c', userId: 'u-c', serviceGroupId: 'g-2', ...CARD },
    { id: 'p-nologin', userId: null, serviceGroupId: 'g-2', ...CARD },
  ];
  const pubRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.congregationId === CONG
        ? (cards.find((c) => c.id === where.id) ?? null)
        : null,
    ),
    find: jest.fn(async ({ where }: any) => {
      if (where.id) {
        const ids: string[] = where.id?._value ?? where.id?.value ?? [];
        return cards.filter((c) => ids.includes(c.id as string));
      }
      return cards.filter(
        (c) =>
          where.congregationId === CONG &&
          (!where.serviceGroupId || c.serviceGroupId === where.serviceGroupId),
      );
    }),
  };
  const groupsRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      ['g-1', 'g-2'].includes(where.id)
        ? { id: where.id, congregationId: CONG }
        : null,
    ),
    find: jest.fn(async () => [
      { id: 'g-1', name: 'Север' },
      { id: 'g-2', name: 'Юг' },
    ]),
  };
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  };
  const notify = { notify: jest.fn().mockResolvedValue(undefined) };
  const resp = { count: jest.fn(async () => 0) };
  const svc = new FieldServiceMeetingsService(
    repo as any,
    pubRepo as any,
    {} as any,
    notify as any,
    audit as any,
    clockStub(),
    groupsRepo as any,
    resp as any,
  );
  return { svc, repo, audit, notify, qb };
}

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => nowSpy.mockRestore());

const row = (id: string, extra: Record<string, unknown>): Row => ({
  id,
  congregationId: CONG,
  // Sat 17 Oct.
  weekStartDate: '2026-10-12',
  dayOfWeek: 6,
  startTime: '10:30',
  address: 'Hall',
  conductorPublisherId: null,
  topic: null,
  notice: null,
  isGeneral: false,
  serviceGroupId: null,
  serviceOverseerVisit: false,
  serviceOverseerPublisherId: null,
  serviceOverseerAssistantId: null,
  publishedAt: new Date('2026-10-01T10:00:00Z'),
  ...extra,
});

const calls = (notify: { notify: jest.Mock }, kind: string) =>
  notify.notify.mock.calls.map((c) => c[0]).filter((i) => i.kind === kind);
const ru = (input: any) => input.text('ru');

async function refusedWith(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e: any) {
    return e?.getResponse?.()?.code;
  }
  return undefined;
}

describe('moving a meeting', () => {
  it('moves it to another week, the same record', async () => {
    const { svc, repo } = build([row('m-1', {})]);
    const saved = await svc.update(CONG, 'm-1', {
      weekStartDate: '2026-10-19',
    } as any);
    expect(saved.weekStartDate).toBe('2026-10-19');
    expect(saved.id).toBe('m-1');
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('refuses a week that is not a Monday', async () => {
    const { svc } = build([row('m-1', {})]);
    expect(
      await refusedWith(
        svc.update(CONG, 'm-1', { weekStartDate: '2026-10-21' } as any),
      ),
    ).toBe('WEEK_NOT_MONDAY');
  });

  it('refuses moving onto a day already past, week and day as one date', async () => {
    const { svc } = build([row('m-1', {})]);
    // Mon 5 Oct + Thursday = 8 Oct, before «today» (9 Oct).
    expect(
      await refusedWith(
        svc.update(CONG, 'm-1', {
          weekStartDate: '2026-10-05',
          dayOfWeek: 4,
        } as any),
      ),
    ).toBe('FS_PAST_LOCKED');
    // Same week, a later day (Sat 10 Oct): allowed.
    const ok = await svc.update(CONG, 'm-1', {
      weekStartDate: '2026-10-05',
      dayOfWeek: 6,
    } as any);
    expect(ok.weekStartDate).toBe('2026-10-05');
  });

  it('writes the week into the journal', async () => {
    const { svc, audit } = build([row('m-1', {})]);
    await svc.update(CONG, 'm-1', { weekStartDate: '2026-10-19' } as any);
    const entry = audit.logUpdate.mock.calls[0][0];
    expect(entry.before.weekStartDate).toBe('2026-10-12');
    expect(entry.after.weekStartDate).toBe('2026-10-19');
    expect(entry.fields).toContain('weekStartDate');
  });

  it('tells the conductor and the group: was and now', async () => {
    const { svc, notify } = build([
      row('m-1', { serviceGroupId: 'g-1', conductorPublisherId: 'p-a' }),
    ]);
    await svc.update(CONG, 'm-1', {
      weekStartDate: '2026-10-19',
      startTime: '10:00',
    } as any);
    const own = calls(notify, 'field_service_meeting');
    expect(own).toHaveLength(1);
    expect(own[0].userIds).toEqual(['u-a']);
    expect(own[0].emailFallback).toBe(true);
    const text = ru(own[0]);
    expect(text.title).toMatch(/изменена/);
    expect(text.body).toMatch(/10:30/);
    expect(text.body).toMatch(/10:00/);
    // The place did not move — not repeated.
    expect(text.body).not.toMatch(/Hall/);
    const group = calls(notify, 'field_service_change');
    expect(group).toHaveLength(1);
    // The rest of g-1; the conductor already has his own message.
    expect(group[0].userIds).toEqual(['u-b']);
    expect(group[0].key).toBe(own[0].key);
  });

  it('names the place when the place moved', async () => {
    const { svc, notify } = build([
      row('m-1', { conductorPublisherId: 'p-a' }),
    ]);
    await svc.update(CONG, 'm-1', { address: 'Park' } as any);
    const text = ru(calls(notify, 'field_service_meeting')[0]);
    expect(text.body).toMatch(/Hall/);
    expect(text.body).toMatch(/Park/);
  });

  it('keeps the news from the group when asked, never from the conductor', async () => {
    const { svc, notify } = build([
      row('m-1', { serviceGroupId: 'g-1', conductorPublisherId: 'p-a' }),
    ]);
    await svc.update(CONG, 'm-1', {
      dayOfWeek: 7,
      notifyAudience: false,
    } as any);
    expect(calls(notify, 'field_service_change')).toHaveLength(0);
    expect(calls(notify, 'field_service_meeting')).toHaveLength(1);
  });

  it('a general meeting moved is news for the whole congregation', async () => {
    const { svc, notify } = build([row('m-1', { isGeneral: true })]);
    await svc.update(CONG, 'm-1', { dayOfWeek: 7 } as any);
    const all = calls(notify, 'field_service_change')[0].userIds;
    expect(all.sort()).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('says nothing about a draft, nor about a change of theme', async () => {
    const draft = build([
      row('m-1', { publishedAt: null, conductorPublisherId: 'p-a' }),
    ]);
    await draft.svc.update(CONG, 'm-1', { dayOfWeek: 7 } as any);
    expect(draft.notify.notify).not.toHaveBeenCalled();

    const theme = build([row('m-1', { conductorPublisherId: 'p-a' })]);
    await theme.svc.update(CONG, 'm-1', { topic: 'Новая тема' } as any);
    expect(theme.notify.notify).not.toHaveBeenCalled();
  });

  it('a new conductor hears «you conduct», not «moved»; the old one «no longer»', async () => {
    const { svc, notify } = build([
      row('m-1', { serviceGroupId: 'g-1', conductorPublisherId: 'p-a' }),
    ]);
    await svc.update(CONG, 'm-1', {
      dayOfWeek: 7,
      conductorPublisherId: 'p-b',
    } as any);
    const own = calls(notify, 'field_service_meeting');
    // unassigned (u-a) and assigned (u-b) — each once, in their own words.
    expect(
      own
        .map((c) => c.userIds)
        .flat()
        .sort(),
    ).toEqual(['u-a', 'u-b']);
    expect(own.every((c) => !c.text)).toBe(true);
    // Nobody else in g-1 is left to tell.
    expect(calls(notify, 'field_service_change')).toHaveLength(0);
  });

  it('on a visit the overseer and his assistant hear it as their own', async () => {
    const { svc, notify } = build([
      row('m-1', {
        serviceGroupId: 'g-1',
        serviceOverseerVisit: true,
        conductorPublisherId: 'p-a',
        serviceOverseerPublisherId: 'p-a',
        serviceOverseerAssistantId: 'p-c',
      }),
    ]);
    await svc.update(CONG, 'm-1', { startTime: '09:30' } as any);
    const own = calls(notify, 'field_service_meeting');
    expect(own[0].userIds.sort()).toEqual(['u-a', 'u-c']);
    expect(calls(notify, 'field_service_change')[0].userIds).toEqual(['u-b']);
  });

  it('refuses to change a cancelled meeting — restore it first', async () => {
    const { svc } = build([row('m-1', { cancelledAt: new Date() })]);
    expect(
      await refusedWith(svc.update(CONG, 'm-1', { dayOfWeek: 7 } as any)),
    ).toBe('FS_CANCELLED');
  });
});

describe('cancelling a meeting', () => {
  it('crosses it out with its reason and tells everyone going', async () => {
    const { svc, notify, audit } = build([
      row('m-1', { serviceGroupId: 'g-1', conductorPublisherId: 'p-a' }),
    ]);
    const saved = await svc.cancel(CONG, 'm-1', {
      reason: '  конгресс  ',
    });
    expect(saved.cancelledAt).toBeInstanceOf(Date);
    expect(saved.cancelReason).toBe('конгресс');
    const own = calls(notify, 'field_service_meeting');
    expect(own[0].userIds).toEqual(['u-a']);
    const text = ru(own[0]);
    expect(text.title).toMatch(/отменена/);
    expect(text.body).toMatch(/конгресс/);
    expect(calls(notify, 'field_service_change')[0].userIds).toEqual(['u-b']);
    expect(audit.logUpdate.mock.calls[0][0].after).toEqual({
      cancelled: true,
      cancelReason: 'конгресс',
    });
  });

  it('a blank reason is none', async () => {
    const { svc } = build([row('m-1', {})]);
    expect(
      (await svc.cancel(CONG, 'm-1', { reason: '   ' })).cancelReason,
    ).toBe(null);
  });

  it('keeps it from the group when asked, never from those assigned', async () => {
    const { svc, notify } = build([
      row('m-1', { serviceGroupId: 'g-1', conductorPublisherId: 'p-a' }),
    ]);
    await svc.cancel(CONG, 'm-1', { notifyAudience: false });
    expect(calls(notify, 'field_service_change')).toHaveLength(0);
    expect(calls(notify, 'field_service_meeting')).toHaveLength(1);
  });

  it('refuses a draft, a cancelled one, and a past one', async () => {
    const draft = build([row('m-1', { publishedAt: null })]);
    expect(await refusedWith(draft.svc.cancel(CONG, 'm-1', {}))).toBe(
      'FS_DRAFT_NOT_CANCELLABLE',
    );
    const twice = build([row('m-1', { cancelledAt: new Date() })]);
    expect(await refusedWith(twice.svc.cancel(CONG, 'm-1', {}))).toBe(
      'FS_ALREADY_CANCELLED',
    );
    // Sat 3 Oct — gone.
    const past = build([row('m-1', { weekStartDate: '2026-09-28' })]);
    expect(await refusedWith(past.svc.cancel(CONG, 'm-1', {}))).toBe(
      'FS_PAST_LOCKED',
    );
  });
});

describe('bringing a cancelled meeting back', () => {
  it('clears the cross and tells everyone it is on again, with the place', async () => {
    const { svc, notify } = build([
      row('m-1', {
        serviceGroupId: 'g-1',
        conductorPublisherId: 'p-a',
        cancelledAt: new Date('2026-10-08T10:00:00Z'),
        cancelReason: 'конгресс',
      }),
    ]);
    const saved = await svc.restore(CONG, 'm-1', {});
    expect(saved.cancelledAt).toBeNull();
    expect(saved.cancelReason).toBeNull();
    const text = ru(calls(notify, 'field_service_meeting')[0]);
    expect(text.title).toMatch(/снова/);
    expect(text.body).toMatch(/Hall/);
    expect(calls(notify, 'field_service_change')[0].userIds).toEqual(['u-b']);
  });

  it('refuses one that is not cancelled', async () => {
    const { svc } = build([row('m-1', {})]);
    expect(await refusedWith(svc.restore(CONG, 'm-1', {}))).toBe(
      'FS_NOT_CANCELLED',
    );
  });
});

describe('deleting an announced meeting', () => {
  it('calls it off for everyone going, the overseer of a visit included', async () => {
    const { svc, notify } = build([
      row('m-1', {
        serviceGroupId: 'g-1',
        serviceOverseerVisit: true,
        conductorPublisherId: 'p-b',
        serviceOverseerPublisherId: 'p-a',
      }),
    ]);
    await svc.remove(CONG, 'm-1');
    const own = calls(notify, 'field_service_meeting');
    expect(own[0].userIds.sort()).toEqual(['u-a', 'u-b']);
    expect(ru(own[0]).title).toMatch(/отменена/);
  });

  it('says nothing more about one already cancelled, nor about a draft', async () => {
    const cancelled = build([
      row('m-1', { conductorPublisherId: 'p-a', cancelledAt: new Date() }),
    ]);
    await cancelled.svc.remove(CONG, 'm-1');
    expect(cancelled.notify.notify).not.toHaveBeenCalled();
    const draft = build([
      row('m-1', { conductorPublisherId: 'p-a', publishedAt: null }),
    ]);
    await draft.svc.remove(CONG, 'm-1');
    expect(draft.notify.notify).not.toHaveBeenCalled();
  });
});

describe('the list', () => {
  it('leaves cancelled meetings out unless the app asks for them', async () => {
    const plain = build([]);
    await plain.svc.list(CONG, { weekStart: '2026-10-12' } as any);
    const where = plain.qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(where).toContain('m.cancelledAt IS NULL');

    const asked = build([]);
    await asked.svc.list(CONG, {
      weekStart: '2026-10-12',
      cancelled: '1',
    } as any);
    const where2 = asked.qb.andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(where2).not.toContain('m.cancelledAt IS NULL');
  });
});
