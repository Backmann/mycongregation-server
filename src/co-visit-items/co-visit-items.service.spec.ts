import {
  CoVisitItemsService,
  toCoVisitItemView,
} from './co-visit-items.service';
import { ConflictException } from '@nestjs/common';
import type { CoVisitItem } from '../entities/co-visit-item.entity';
import { clockStub } from '../common/testing/clock-stub';

function item(partial: Partial<CoVisitItem>): CoVisitItem {
  return {
    id: 'i1',
    congregationId: 'c1',
    specialEventId: 'e1',
    kind: 'field_service',
    forWife: false,
    itemDate: '2026-07-08',
    startTime: '10:00',
    placeKind: 'kingdom_hall',
    cartLocationId: null,
    placeText: null,
    assigneePublisherId: null,
    assigneeText: null,
    note: null,
    sortOrder: 0,
    ...partial,
  } as CoVisitItem;
}

describe('CoVisitItemsService — a removed item is kept, not erased', () => {
  /**
   * `visitEnds` decides whether the visit is still open for changes: a visit
   * already over is a record, and its programme is frozen the same way the
   * duties of a past meeting are. Far in the future by default, so the cases
   * below go on testing what they were written to test.
   */
  const build = (item: any, audit: any, visitEnds = '2099-12-31') => {
    const repo = {
      findOne: jest.fn(async () => item),
      softDelete: jest.fn(async () => ({ affected: 1 })),
      restore: jest.fn(async () => ({ affected: 1 })),
    } as any;
    const eventsRepo = {
      findOne: jest.fn(async () => ({
        id: 'ev-1',
        date: visitEnds,
        endDate: visitEnds,
      })),
    } as any;
    const svc = new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      {} as any,
      {} as any,
      audit as never,
      clockStub(),
    );
    return { svc, repo };
  };

  it('hides the row instead of deleting it', async () => {
    // One mis-tap used to mean decrypting last night's backup and reading the
    // values out by hand.
    const audit = { logEvent: jest.fn(), logUpdate: jest.fn() };
    const { svc, repo } = build(
      { id: 'i1', kind: 'lunch', itemDate: '2026-08-06', startTime: '12:00' },
      audit,
    );

    await svc.remove('c1', 'i1', 'user-1');

    expect(repo.softDelete).toHaveBeenCalledWith({
      id: 'i1',
      congregationId: 'c1',
    });
  });

  it('writes what was removed into the journal', async () => {
    // The row carries the state, but a person looking for what was lost looks
    // in the journal — and would find nothing there if we only flipped a flag.
    const audit = { logEvent: jest.fn(), logUpdate: jest.fn() };
    const { svc } = build(
      { id: 'i1', kind: 'lunch', itemDate: '2026-08-06', startTime: '12:00' },
      audit,
    );

    await svc.remove('c1', 'i1', 'user-1');

    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        detail: expect.objectContaining({
          kind: 'lunch',
          itemDate: '2026-08-06',
        }),
      }),
    );
  });

  it('puts it back', async () => {
    const audit = { logEvent: jest.fn(), logUpdate: jest.fn() };
    const { svc, repo } = build(
      {
        id: 'i1',
        kind: 'lunch',
        itemDate: '2026-08-06',
        deletedAt: new Date(),
      },
      audit,
    );

    await svc.restore('c1', 'i1');

    expect(repo.restore).toHaveBeenCalledWith({
      id: 'i1',
      congregationId: 'c1',
    });
  });

  it('does nothing when the item was never removed', async () => {
    const audit = { logEvent: jest.fn(), logUpdate: jest.fn() };
    const { svc, repo } = build({ id: 'i1', deletedAt: null }, audit);

    await svc.restore('c1', 'i1');

    expect(repo.restore).not.toHaveBeenCalled();
  });
});

describe('toCoVisitItemView', () => {
  it('resolves assignee "Last First" when a publisher is set', () => {
    const v = toCoVisitItemView(
      item({
        assigneePublisherId: 'p1',
        assignee: { firstName: 'Alex', lastName: 'Weichel' } as never,
      }),
      true,
    );
    expect(v.assigneeName).toBe('Weichel Alex');
    expect(v.assigneeText).toBeNull();
  });

  it('leaves assigneeName null and keeps free-text when no publisher', () => {
    const v = toCoVisitItemView(
      item({ assignee: null, assigneeText: 'Familie Müller' }),
      true,
    );
    expect(v.assigneeName).toBeNull();
    expect(v.assigneeText).toBe('Familie Müller');
  });

  it('surfaces cart location name when present', () => {
    const v = toCoVisitItemView(
      item({
        placeKind: 'cart_location',
        cartLocationId: 'l1',
        cartLocation: { name: 'Hauptbahnhof' } as never,
      }),
      true,
    );
    expect(v.cartLocationName).toBe('Hauptbahnhof');
  });

  it('exposes phone/address only when canViewPrivate', () => {
    const it = item({
      assigneePublisherId: 'p1',
      assignee: {
        firstName: 'Alex',
        lastName: 'Weichel',
        mobilePhone: '0157 1234',
        address: 'Musterstr. 1',
      } as never,
    });
    const shown = toCoVisitItemView(it, true);
    expect(shown.assigneePhone).toBe('0157 1234');
    expect(shown.assigneeAddress).toBe('Musterstr. 1');
    const hidden = toCoVisitItemView(it, false);
    expect(hidden.assigneePhone).toBeNull();
    expect(hidden.assigneeAddress).toBeNull();
  });
});

describe('CoVisitItemsService.mine', () => {
  const CONG = 'c1';
  const USER = { id: 'u1', role: 'publisher' } as any;
  const visit = {
    id: 'v1',
    title: 'Посещение РН',
    date: '2099-01-05',
    endDate: '2099-01-11',
  };

  function build(publisher: any, items: any[]) {
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [{ ...visit, type: 'circuit_overseer_visit' }]),
    } as any;
    const usersRepo = {} as any;
    const publishersRepo = { findOne: jest.fn(async () => publisher) } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => false),
    } as any;
    return new CoVisitItemsService(
      repo,
      eventsRepo,
      usersRepo,
      publishersRepo,
      auxService,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );
  }
  const base = {
    congregationId: CONG,
    specialEventId: 'v1',
    itemDate: '2099-01-06',
    startTime: '09:30',
    placeKind: 'kingdom_hall',
    cartLocationId: null,
    cartLocation: null,
    placeText: 'Hall',
    assignee: null,
    assigneePublisherId: null,
    assigneeText: null,
    note: null,
    sortOrder: 0,
    forWife: false,
    withWife: false,
  };

  it("returns partner items with serviceWith and the person's OWN note", async () => {
    const items = [
      {
        ...base,
        id: 'co1',
        kind: 'field_service',
        assigneePublisherId: 'other',
        note: 'Повторные посещения',
      },
      {
        ...base,
        id: 'w1',
        kind: 'field_service',
        forWife: true,
        assigneePublisherId: 'p1',
        note: 'Изучения',
      },
    ];
    const svc = build(
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      items,
    );
    const out = await svc.mine(CONG, USER);
    expect(out).toHaveLength(1);
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0].serviceWith).toBe('wife');
    expect(out[0].items[0].note).toBe('Изучения');
  });

  it('shows the pioneer meeting to all pioneers (regular/special/missionary)', async () => {
    const items = [{ ...base, id: 'pm', kind: 'pioneers' }];
    const reg = build(
      { id: 'p1', pioneerType: 'regular', appointment: 'publisher' },
      items,
    );
    expect((await reg.mine(CONG, USER))[0]?.items).toHaveLength(1);

    // Special pioneers and missionaries are pioneers too.
    const special = build(
      { id: 'p1', pioneerType: 'special', appointment: 'publisher' },
      items,
    );
    expect((await special.mine(CONG, USER))[0]?.items).toHaveLength(1);
    const missionary = build(
      { id: 'p1', pioneerType: 'missionary', appointment: 'publisher' },
      items,
    );
    expect((await missionary.mine(CONG, USER))[0]?.items).toHaveLength(1);

    const plain = build(
      {
        id: 'p1',
        pioneerType: 'none',
        appointment: 'publisher',
      },
      items,
    );
    expect(await plain.mine(CONG, USER)).toHaveLength(0);

    // Pioneer whose start date is in the future is not yet a pioneer.
    const future = build(
      {
        id: 'p1',
        pioneerType: 'regular',
        pioneerSince: '2999-01-01',
        appointment: 'publisher',
      },
      items,
    );
    expect(await future.mine(CONG, USER)).toHaveLength(0);
  });

  it('shows the pioneer meeting to an auxiliary pioneer serving this month', async () => {
    const items = [{ ...base, id: 'pm', kind: 'pioneers' }];
    // Publisher with no permanent pioneer type, but auxiliary this month.
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [{ ...visit, type: 'circuit_overseer_visit' }]),
    } as any;
    const publishersRepo = {
      findOne: jest.fn(async () => ({
        id: 'p1',
        pioneerType: 'none',
        appointment: 'publisher',
      })),
    } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => true),
    } as any;
    const svc = new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      publishersRepo,
      auxService,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );
    expect((await svc.mine(CONG, USER))[0]?.items).toHaveLength(1);
  });

  it('shows the elders meeting to elders and ministerial servants only', async () => {
    const items = [{ ...base, id: 'em', kind: 'elders' }];
    const ms = build(
      { id: 'p1', pioneerType: 'none', appointment: 'ministerial_servant' },
      items,
    );
    expect((await ms.mine(CONG, USER))[0]?.items).toHaveLength(1);
    const pub = build(
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      items,
    );
    expect(await pub.mine(CONG, USER)).toHaveLength(0);
  });

  it('returns nothing when the user has no linked publisher', async () => {
    const svc = build(null, [{ ...base, id: 'x', kind: 'lunch' }]);
    expect(await svc.mine(CONG, USER)).toHaveLength(0);
  });
});

describe('CoVisitItemsService.hostStats', () => {
  it('aggregates totals with past lastDate and future nextDate per kind', async () => {
    const rows = [
      { kind: 'lunch', itemDate: '2020-01-01', assigneePublisherId: 'p1' },
      { kind: 'lunch', itemDate: '2020-06-01', assigneePublisherId: 'p1' },
      { kind: 'lunch', itemDate: '2099-01-01', assigneePublisherId: 'p2' },
      { kind: 'lunch_box', itemDate: '2020-03-01', assigneePublisherId: 'p1' },
    ];
    const qb: any = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getMany: async () => rows,
    };
    // Accommodation history comes from the visits themselves, so the service
    // asks the manager too.
    const visitQb: any = {
      select: () => visitQb,
      where: () => visitQb,
      andWhere: () => visitQb,
      getMany: async () => [
        { date: '2019-05-01', coAccommodationPublisherId: 'p3' },
        { date: '2099-05-01', coAccommodationPublisherId: 'p3' },
      ],
    };
    const repo = {
      createQueryBuilder: () => qb,
      manager: { createQueryBuilder: () => visitQb },
    } as any;
    const svc = new CoVisitItemsService(
      repo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );
    const out = await svc.hostStats('c1');
    const p1lunch = out.find(
      (s) => s.publisherId === 'p1' && s.kind === 'lunch',
    );
    expect(p1lunch).toMatchObject({
      total: 2,
      lastDate: '2020-06-01',
      nextDate: null,
    });
    const p2 = out.find((s) => s.publisherId === 'p2');
    expect(p2).toMatchObject({
      total: 1,
      lastDate: null,
      nextDate: '2099-01-01',
    });
    expect(out.find((s) => s.kind === 'lunch_box')?.total).toBe(1);
  });
});

describe('CoVisitItemsService.hostStats — counted per kind', () => {
  // Hosting lunch three times says nothing about whether someone has ever
  // gone out in the ministry with the overseer; rolling the kinds together
  // would send the same few names round every time.
  function run(rows: any[], visits: any[] = []) {
    const qb: any = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getMany: async () => rows,
    };
    const visitQb: any = {
      select: () => visitQb,
      where: () => visitQb,
      andWhere: () => visitQb,
      getMany: async () => visits,
    };
    const repo = {
      createQueryBuilder: () => qb,
      manager: { createQueryBuilder: () => visitQb },
    } as any;
    return new CoVisitItemsService(
      repo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    ).hostStats('c1');
  }

  it('keeps the ministry apart from the lunches for the same person', async () => {
    const out = await run([
      { kind: 'lunch', itemDate: '2020-01-01', assigneePublisherId: 'p1' },
      { kind: 'lunch', itemDate: '2021-01-01', assigneePublisherId: 'p1' },
      {
        kind: 'field_service',
        itemDate: '2020-02-01',
        assigneePublisherId: 'p1',
      },
    ]);
    const lunch = out.find((x) => x.publisherId === 'p1' && x.kind === 'lunch');
    const service = out.find(
      (x) => x.publisherId === 'p1' && x.kind === 'field_service',
    );
    expect(lunch?.total).toBe(2);
    expect(service?.total).toBe(1);
  });

  it('counts a shepherding call as its own kind', async () => {
    const out = await run([
      { kind: 'pastoral', itemDate: '2020-04-01', assigneePublisherId: 'p2' },
    ]);
    expect(out.find((x) => x.kind === 'pastoral')?.total).toBe(1);
  });

  // Accommodation lives on the visit, not on an item, but the question is the
  // same: who has already put them up, and how long ago.
  it('answers the accommodation question from the visits themselves', async () => {
    const out = await run(
      [],
      [
        { date: '2019-05-01', coAccommodationPublisherId: 'p3' },
        { date: '2099-05-01', coAccommodationPublisherId: 'p3' },
      ],
    );
    const acc = out.find((x) => x.kind === 'accommodation');
    expect(acc?.publisherId).toBe('p3');
    expect(acc?.total).toBe(2);
    expect(acc?.lastDate).toBe('2019-05-01');
    expect(acc?.nextDate).toBe('2099-05-01');
  });
});

describe('CoVisitItemsService.mine — accommodation host & legacy copies', () => {
  const CONG = 'c1';
  const USER = { id: 'u1', role: 'publisher' } as any;

  function build(visitExtra: any, publisher: any, items: any[]) {
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [
        {
          id: 'v1',
          title: 'Визит',
          date: '2099-01-05',
          endDate: '2099-01-11',
          type: 'circuit_overseer_visit',
          ...visitExtra,
        },
      ]),
    } as any;
    const publishersRepo = { findOne: jest.fn(async () => publisher) } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => false),
    } as any;
    return new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      publishersRepo,
      auxService,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );
  }

  it('gives the accommodation host a synthetic item', async () => {
    const svc = build(
      { coAccommodationPublisherId: 'p1' },
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      [],
    );
    const out = await svc.mine(CONG, USER);
    expect(out).toHaveLength(1);
    expect(out[0].items[0].kind).toBe('accommodation');
  });

  it('skips legacy wife copies of shared kinds (no duplicates)', async () => {
    const base = {
      congregationId: CONG,
      specialEventId: 'v1',
      itemDate: '2099-01-06',
      startTime: '12:15',
      placeKind: null,
      cartLocationId: null,
      cartLocation: null,
      placeText: null,
      assignee: null,
      assigneeText: null,
      note: null,
      sortOrder: 0,
      withWife: false,
    };
    const svc = build(
      {},
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      [
        {
          ...base,
          id: 'l1',
          kind: 'lunch',
          forWife: false,
          assigneePublisherId: 'p1',
        },
        {
          ...base,
          id: 'l2',
          kind: 'lunch',
          forWife: true,
          assigneePublisherId: 'p1',
        },
      ],
    );
    const out = await svc.mine(CONG, USER);
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0].id).toBe('l1');
  });
});

describe('CoVisitItemsService.fieldService', () => {
  const CONG = 'c1';
  const visit = {
    id: 'v1',
    title: 'Посещение РН',
    date: '2099-01-05',
    endDate: '2099-01-11',
    type: 'circuit_overseer_visit',
  };

  function build(items: any[]) {
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = { find: jest.fn(async () => [visit]) } as any;
    return new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      {} as any,
      {
        isActiveAuxiliaryPioneer: jest.fn(async () => false),
      } as any,
      { logEvent: jest.fn(), logUpdate: jest.fn() } as never,
      clockStub(),
    );
  }

  const fs = {
    id: 'i1',
    kind: 'field_service',
    forWife: false,
    itemDate: '2099-01-07',
    startTime: '09:30',
    placeKind: 'kingdom_hall',
    placeText: 'Зал',
    cartLocation: null,
    assignee: { displayName: 'Брат А' },
    assigneePhone: '+49 123',
    assigneeAddress: 'Musterstr. 1',
    note: 'частная пометка',
    sortOrder: 0,
  };

  it('returns the visit and its field-service meetings', async () => {
    const svc = build([fs]);
    const out = await svc.fieldService(CONG);
    expect(out).toHaveLength(1);
    expect(out[0].visit.id).toBe('v1');
    expect(out[0].meetings).toEqual([
      {
        id: 'i1',
        itemDate: '2099-01-07',
        startTime: '09:30',
        place: 'Зал',
      },
    ]);
  });

  // The full item list is elder-only because of exactly these fields; the
  // public view must not leak them back out.
  it('never exposes phones, addresses or notes', async () => {
    const svc = build([fs]);
    const out = await svc.fieldService(CONG);
    const asText = JSON.stringify(out);
    // The assignee on a visit item is the brother going out WITH the overseer,
    // not a conductor — naming him publicly was both untrue and personal.
    expect(asText).not.toContain('Брат А');
    expect(asText).not.toContain('+49 123');
    expect(asText).not.toContain('Musterstr. 1');
    expect(asText).not.toContain('частная пометка');
  });

  it('uses the cart location as the place when the item points at one', async () => {
    const svc = build([
      {
        ...fs,
        placeKind: 'cart_location',
        cartLocation: { name: 'Rathaus' },
        placeText: null,
      },
    ]);
    const out = await svc.fieldService(CONG);
    expect(out[0].meetings[0].place).toBe('Rathaus');
  });

  // The overseer's row and his wife's paired row describe ONE outing; two
  // rows on the schedule must not become two announcements.
  it('collapses the overseer and wife rows of the same outing', async () => {
    const svc = build([
      fs,
      { ...fs, id: 'i2', forWife: true },
      { ...fs, id: 'i3', startTime: '14:00' },
      { ...fs, id: 'i4', startTime: '14:00', forWife: true },
    ]);
    const out = await svc.fieldService(CONG);
    expect(out[0].meetings.map((m) => m.startTime)).toEqual(['09:30', '14:00']);
  });

  it('keeps a separate outing at another place apart', async () => {
    const svc = build([fs, { ...fs, id: 'i5', placeText: 'Другое место' }]);
    const out = await svc.fieldService(CONG);
    expect(out[0].meetings).toHaveLength(2);
  });

  it('skips a visit that has no field-service meetings', async () => {
    const svc = build([]);
    await expect(svc.fieldService(CONG)).resolves.toEqual([]);
  });
});

describe('CoVisitItemsService — a visit already over is a record', () => {
  // The strip of visits opened the earlier ones for READING, which is what it
  // was asked for — but it opened them for writing just as much, and last
  // year's programme is something the congregation reports on, not something
  // anyone should be able to quietly rewrite. The same rule the duties of a
  // past meeting already follow.
  const PAST = '2020-05-10';
  const FUTURE = '2099-12-31';

  function build(visitEnds: string) {
    const item = {
      id: 'it-1',
      congregationId: 'cong-1',
      specialEventId: 'ev-1',
      kind: 'lunch',
      itemDate: visitEnds,
      startTime: null,
      placeText: null,
      deletedAt: new Date(),
    } as any;
    const repo = {
      findOne: jest.fn(async () => item),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => ({ ...x, id: 'new-1' })),
      softDelete: jest.fn(async () => ({ affected: 1 })),
      restore: jest.fn(async () => ({ affected: 1 })),
    } as any;
    const eventsRepo = {
      findOne: jest.fn(async () => ({
        id: 'ev-1',
        date: visitEnds,
        endDate: visitEnds,
      })),
    } as any;
    const audit = {
      logEvent: jest.fn(),
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
    };
    const svc = new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      {} as any,
      {} as any,
      audit as never,
      clockStub(),
    );
    return { svc, repo, audit };
  }

  const user = { userId: 'u-1' } as any;

  it('refuses to add to a visit that is over', async () => {
    const { svc, repo } = build(PAST);
    await expect(
      svc.create(
        'cong-1',
        { specialEventId: 'ev-1', kind: 'lunch', itemDate: PAST } as any,
        user,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to change one, to remove one, and to put one back', async () => {
    for (const call of [
      (s: CoVisitItemsService) => s.update('cong-1', 'it-1', {}, user),
      (s: CoVisitItemsService) => s.remove('cong-1', 'it-1', 'u-1'),
      (s: CoVisitItemsService) => s.restore('cong-1', 'it-1'),
    ]) {
      const { svc, repo } = build(PAST);
      await expect(call(svc)).rejects.toThrow(ConflictException);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    }
  });

  it('writes the refusal to the journal — a rejection that leaves no trace answers nothing', async () => {
    const { svc, audit } = build(PAST);
    await expect(svc.remove('cong-1', 'it-1', 'u-1')).rejects.toThrow();
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DENY',
        entityType: 'co_visit_item',
        detail: expect.objectContaining({ reason: 'past_visit_frozen' }),
      }),
    );
  });

  it('leaves a visit still to come alone', async () => {
    const { svc, repo } = build(FUTURE);
    await svc.remove('cong-1', 'it-1', 'u-1');
    expect(repo.softDelete).toHaveBeenCalled();
  });
});
