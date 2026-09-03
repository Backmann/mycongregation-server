import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MeService } from './me.service';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { MemorialItem } from '../entities/memorial-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { clockStub } from '../common/testing/clock-stub';

describe('MeService.myPublisher', () => {
  let service: MeService;
  let publishersRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    publishersRepo = { findOne: jest.fn() };
    const stub = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CongregationClock, useValue: clockStub() },
        MeService,
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
        { provide: getRepositoryToken(ServiceGroup), useValue: stub },
        { provide: getRepositoryToken(Assignment), useValue: stub },
        { provide: getRepositoryToken(Duty), useValue: stub },
        { provide: getRepositoryToken(CleaningAssignment), useValue: stub },
        { provide: getRepositoryToken(FieldServiceMeeting), useValue: stub },
        { provide: getRepositoryToken(TalkExchange), useValue: stub },
        { provide: getRepositoryToken(ExternalCongregation), useValue: stub },
        { provide: getRepositoryToken(PublicTalk), useValue: stub },
        { provide: getRepositoryToken(CartAssignment), useValue: stub },
        { provide: getRepositoryToken(CoVisitItem), useValue: stub },
        { provide: getRepositoryToken(MemorialItem), useValue: stub },
        { provide: getRepositoryToken(SpecialEvent), useValue: stub },
        {
          provide: AuditLogService,
          useValue: { logUpdate: jest.fn(), logCreate: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(MeService);
  });

  it('returns null when no publisher is linked to the user', async () => {
    publishersRepo.findOne.mockResolvedValue(null);
    const res = await service.myPublisher('c1', 'u1');
    expect(res).toEqual({ publisher: null });
    expect(publishersRepo.findOne).toHaveBeenCalledWith({
      where: { congregationId: 'c1', userId: 'u1' },
    });
  });

  // Home tells a man his own standing; without this he would have to fetch
  // the whole roster and find himself in it. It is not private — every
  // publisher already sees appointments in the roster.
  it('carries the appointment, so home can say it without the roster', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p1',
      displayName: 'Lionel B.',
      firstName: 'Lionel',
      lastName: 'Backmann',
      pioneerType: 'regular',
      appointment: 'elder',
      serviceGroupId: 'g1',
      mobilePhone: null,
      email: null,
      address: null,
      contactsConfirmedAt: null,
      contactsConfirmedByUserId: null,
    });
    const res = await service.myPublisher('c1', 'u1');
    expect(res.publisher?.appointment).toBe('elder');
  });

  it('returns identity and own contacts, never staff-only fields', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p1',
      displayName: 'Adele B.',
      firstName: 'Adele',
      lastName: 'Backmann',
      pioneerType: 'none',
      serviceGroupId: 'g1',
      // Own contacts DO belong here — the publisher edits them from this card.
      mobilePhone: '+49 151 000',
      email: 'private@example.org',
      address: 'Alte Soester Str. 7',
      contactsConfirmedAt: null,
      contactsConfirmedByUserId: null,
      // Staff-only commentary must still never leak.
      notes: 'sensitive',
    });
    const res = await service.myPublisher('c1', 'u1');
    expect(res).toEqual({
      publisher: {
        id: 'p1',
        displayName: 'Adele B.',
        firstName: 'Adele',
        lastName: 'Backmann',
        pioneerType: 'none',
        appointment: null,
        serviceGroupId: 'g1',
        mobilePhone: '+49 151 000',
        email: 'private@example.org',
        address: 'Alte Soester Str. 7',
        contactsConfirmedAt: null,
        contactsConfirmedByUserId: null,
        contactsConfirmedByName: null,
      },
    });
    expect(JSON.stringify(res)).not.toContain('sensitive');
  });

  it('normalizes a missing pioneerType to null', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p2',
      displayName: 'X',
      firstName: 'X',
      lastName: 'Y',
      pioneerType: undefined,
    });
    const res = await service.myPublisher('c1', 'u2');
    expect(res.publisher?.pioneerType).toBeNull();
  });
});

describe('MeService.myAssignments (outgoing talks)', () => {
  const makeQb = (rows: unknown[]) => {
    const qb: Record<string, unknown> = {};
    for (const m of [
      'where',
      'andWhere',
      'orderBy',
      'leftJoin',
      'leftJoinAndSelect',
      'innerJoin',
      'innerJoinAndSelect',
      'select',
      'addSelect',
    ]) {
      qb[m] = () => qb;
    }
    qb.getMany = async () => rows;
    return qb;
  };
  const emptyRepo = () => ({
    createQueryBuilder: () => makeQb([]),
    findOne: async () => null,
    // `find` joined the stub when the Memorial arrived: its programme and its
    // event are read with find, not through a query builder.
    find: async () => [],
  });

  it('includes an outgoing public talk with host hall details', async () => {
    const publishersRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'pub-1', displayName: 'Ivan' }),
    };
    const talkExchangeRepo = {
      createQueryBuilder: () =>
        makeQb([
          {
            date: '2030-01-06',
            publisherId: 'pub-1',
            hostCongregationId: 'ext-1',
            publicTalkId: 'talk-1',
            direction: 'outgoing',
          },
        ]),
    };
    const externalRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'ext-1',
        name: 'Ahlen',
        address: 'Hauptstr. 1',
        meetingTime: '10:00',
        mapUrl: 'https://maps.example/ahlen',
      }),
    };
    const publicTalksRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'talk-1', number: 42, title: 'Hope' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CongregationClock, useValue: clockStub() },
        MeService,
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
        { provide: getRepositoryToken(ServiceGroup), useValue: emptyRepo() },
        { provide: getRepositoryToken(Assignment), useValue: emptyRepo() },
        { provide: getRepositoryToken(Duty), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(FieldServiceMeeting),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(TalkExchange),
          useValue: talkExchangeRepo,
        },
        {
          provide: getRepositoryToken(ExternalCongregation),
          useValue: externalRepo,
        },
        { provide: getRepositoryToken(PublicTalk), useValue: publicTalksRepo },
        {
          provide: getRepositoryToken(CartAssignment),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(CoVisitItem),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(MemorialItem),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(SpecialEvent),
          useValue: emptyRepo(),
        },
        {
          provide: AuditLogService,
          useValue: { logUpdate: jest.fn(), logCreate: jest.fn() },
        },
      ],
    }).compile();
    const service = moduleRef.get(MeService);

    const res = await service.myAssignments('cong-1', 'user-1');
    const out = res.items.find((i) => i.kind === 'outgoing_talk');
    expect(out).toBeDefined();
    expect(out?.label).toBe('№42. Hope');
    expect(out?.location).toBe('Hauptstr. 1');
    expect(out?.time).toBe('10:00');
    expect(out?.mapUrl).toBe('https://maps.example/ahlen');
    expect(out?.congregationName).toBe('Ahlen');
  });
});

/**
 * The Memorial on a person's own list.
 *
 * Two things had no line here at all. Its PROGRAMME lives in `memorial_items`
 * rather than in `assignments`, so the brother saying the prayer for the bread
 * saw nothing anywhere. Its PLACES did arrive — they are ordinary duties of a
 * third kind of meeting — but with a week and no day, because a duty is dated
 * from the midweek and weekend settings and the Memorial is in neither.
 *
 * The evening brings its own day, hour and address, which is why both are
 * answered from the event.
 */
describe('MeService.myAssignments (the Memorial)', () => {
  const makeQb = (rows: unknown[]) => {
    const qb: Record<string, unknown> = {};
    for (const m of [
      'where',
      'andWhere',
      'orderBy',
      'leftJoin',
      'leftJoinAndSelect',
      'innerJoin',
      'innerJoinAndSelect',
      'select',
      'addSelect',
    ]) {
      qb[m] = () => qb;
    }
    qb.getMany = async () => rows;
    return qb;
  };
  const emptyRepo = () => ({
    createQueryBuilder: () => makeQb([]),
    findOne: async () => null,
    find: async () => [],
  });

  const MEMORIAL = {
    id: 'ev-mem',
    congregationId: 'cong-1',
    type: 'memorial',
    date: '2030-04-17', // a Wednesday
    time: '19:30',
    address: 'Gemeindehaus, Hauptstr. 5',
    memorialPublishedAt: new Date('2030-03-01T10:00:00Z'),
  };

  async function build(opts: {
    event?: Record<string, unknown>;
    lines?: unknown[];
    duties?: unknown[];
  }) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CongregationClock, useValue: clockStub() },
        MeService,
        {
          provide: getRepositoryToken(Publisher),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'pub-1',
              displayName: 'Ivan',
              serviceGroupId: null,
            }),
          },
        },
        { provide: getRepositoryToken(ServiceGroup), useValue: emptyRepo() },
        { provide: getRepositoryToken(Assignment), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(Duty),
          useValue: {
            createQueryBuilder: () => makeQb(opts.duties ?? []),
            findOne: async () => null,
            find: async () => [],
          },
        },
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(FieldServiceMeeting),
          useValue: emptyRepo(),
        },
        { provide: getRepositoryToken(TalkExchange), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(ExternalCongregation),
          useValue: emptyRepo(),
        },
        { provide: getRepositoryToken(PublicTalk), useValue: emptyRepo() },
        { provide: getRepositoryToken(CartAssignment), useValue: emptyRepo() },
        { provide: getRepositoryToken(CoVisitItem), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(MemorialItem),
          useValue: {
            createQueryBuilder: () => makeQb([]),
            findOne: async () => null,
            find: async () => opts.lines ?? [],
          },
        },
        {
          provide: getRepositoryToken(SpecialEvent),
          useValue: {
            createQueryBuilder: () => makeQb([]),
            findOne: async () => null,
            find: async () => [opts.event ?? MEMORIAL],
          },
        },
        {
          provide: AuditLogService,
          useValue: { logUpdate: jest.fn(), logCreate: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(MeService);
  }

  it('gives a programme line the evening: day, hour and where it is held', async () => {
    const service = await build({
      lines: [
        {
          id: 'li-1',
          specialEventId: 'ev-mem',
          label: 'Молитва за хлеб',
          partKey: 'prayer_bread',
          sortOrder: 4,
          publisherId: 'pub-1',
        },
      ],
    });

    const res = await service.myAssignments('cong-1', 'user-1');
    const line = res.items.find((i) => i.eventType === 'memorial');
    expect(line).toBeDefined();
    expect(line?.kind).toBe('meeting');
    expect(line?.label).toBe('Молитва за хлеб');
    expect(line?.date).toBe('2030-04-17');
    expect(line?.time).toBe('19:30');
    expect(line?.location).toBe('Gemeindehaus, Hauptstr. 5');
    // The Wednesday belongs to the week starting Monday the 15th.
    expect(line?.weekStartDate).toBe('2030-04-15');
  });

  it('dates a place at the Memorial from the evening, not from the week', async () => {
    const service = await build({
      duties: [
        {
          id: 'du-1',
          weekStartDate: '2030-04-15',
          eventType: 'memorial',
          dutyType: 'custom',
          customLabel: 'Стоянка',
          publisherId: 'pub-1',
          slotIndex: 0,
        },
      ],
    });

    const res = await service.myAssignments('cong-1', 'user-1');
    const duty = res.items.find((i) => i.kind === 'duty');
    expect(duty?.label).toBe('Стоянка');
    expect(duty?.date).toBe('2030-04-17');
    expect(duty?.time).toBe('19:30');
  });

  it('says nothing about a programme that has not been published', async () => {
    const service = await build({
      event: { ...MEMORIAL, memorialPublishedAt: null },
      lines: [
        {
          id: 'li-1',
          specialEventId: 'ev-mem',
          label: 'Молитва за хлеб',
          partKey: 'prayer_bread',
          sortOrder: 4,
          publisherId: 'pub-1',
        },
      ],
    });

    const res = await service.myAssignments('cong-1', 'user-1');
    expect(res.items.some((i) => i.kind === 'meeting')).toBe(false);
  });

  it('still dates a PLACE at an unpublished Memorial — places are not a draft', async () => {
    const service = await build({
      event: { ...MEMORIAL, memorialPublishedAt: null },
      duties: [
        {
          id: 'du-1',
          weekStartDate: '2030-04-15',
          eventType: 'memorial',
          dutyType: 'custom',
          customLabel: 'Фойе',
          publisherId: 'pub-1',
          slotIndex: 0,
        },
      ],
    });

    const res = await service.myAssignments('cong-1', 'user-1');
    const duty = res.items.find((i) => i.kind === 'duty');
    expect(duty?.date).toBe('2030-04-17');
  });
});

/**
 * The dots in the week drawer, on a Memorial week.
 *
 * The drawer has two tabs and the Memorial is a third kind of meeting, so its
 * marks go on the kind it TOOK — otherwise a brother opens the week the list
 * now offers him and finds no sign that anything there is his.
 */
describe('MeService.myWeeks (the Memorial)', () => {
  const makeQb = (rows: unknown[]) => {
    const qb: Record<string, unknown> = {};
    for (const m of [
      'where',
      'andWhere',
      'orderBy',
      'select',
      'addSelect',
      'groupBy',
      'addGroupBy',
    ]) {
      qb[m] = () => qb;
    }
    qb.getRawMany = async () => rows;
    qb.getMany = async () => rows;
    return qb;
  };
  const emptyRepo = () => ({
    createQueryBuilder: () => makeQb([]),
    findOne: async () => null,
    find: async () => [],
  });

  async function build(opts: {
    events: Record<string, unknown>[];
    duties?: unknown[];
    lines?: unknown[];
  }) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CongregationClock, useValue: clockStub() },
        MeService,
        {
          provide: getRepositoryToken(Publisher),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'pub-1', serviceGroupId: null }),
          },
        },
        { provide: getRepositoryToken(ServiceGroup), useValue: emptyRepo() },
        { provide: getRepositoryToken(Assignment), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(Duty),
          useValue: {
            createQueryBuilder: () => makeQb(opts.duties ?? []),
            findOne: async () => null,
            find: async () => [],
          },
        },
        {
          provide: getRepositoryToken(CleaningAssignment),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(FieldServiceMeeting),
          useValue: emptyRepo(),
        },
        { provide: getRepositoryToken(TalkExchange), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(ExternalCongregation),
          useValue: emptyRepo(),
        },
        { provide: getRepositoryToken(PublicTalk), useValue: emptyRepo() },
        { provide: getRepositoryToken(CartAssignment), useValue: emptyRepo() },
        { provide: getRepositoryToken(CoVisitItem), useValue: emptyRepo() },
        {
          provide: getRepositoryToken(MemorialItem),
          useValue: {
            createQueryBuilder: () => makeQb([]),
            findOne: async () => null,
            find: async () => opts.lines ?? [],
          },
        },
        {
          provide: getRepositoryToken(SpecialEvent),
          useValue: {
            createQueryBuilder: () => makeQb([]),
            findOne: async () => null,
            find: async () => opts.events,
          },
        },
        {
          provide: AuditLogService,
          useValue: { logUpdate: jest.fn(), logCreate: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(MeService);
  }

  it('marks a place at a Wednesday Memorial as the midweek meeting', async () => {
    const service = await build({
      events: [
        {
          id: 'ev-1',
          type: 'memorial',
          date: '2030-04-17',
          memorialPublishedAt: null,
        },
      ],
      duties: [{ week: '2030-04-15', eventType: 'memorial' }],
    });

    const weeks = await service.myWeeks('cong-1', 'user-1');
    const week = weeks.find((w) => w.weekStartDate === '2030-04-15');
    expect(week?.midweekDuties).toBe(true);
    expect(week?.weekendDuties).toBe(false);
  });

  it('marks a published programme line as a part of the meeting it took', async () => {
    const service = await build({
      events: [
        {
          id: 'ev-1',
          // A Sunday: it takes the weekend meeting.
          type: 'memorial',
          date: '2030-04-21',
          memorialPublishedAt: new Date('2030-03-01T10:00:00Z'),
        },
      ],
      lines: [{ id: 'li-1', specialEventId: 'ev-1', publisherId: 'pub-1' }],
    });

    const weeks = await service.myWeeks('cong-1', 'user-1');
    const week = weeks.find((w) => w.weekStartDate === '2030-04-15');
    expect(week?.weekendParts).toBe(true);
    expect(week?.midweekParts).toBe(false);
  });
});
