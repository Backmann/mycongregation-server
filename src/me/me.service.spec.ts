import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeService } from './me.service';
import { Publisher } from '../entities/publisher.entity';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';

describe('MeService.myPublisher', () => {
  let service: MeService;
  let publishersRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    publishersRepo = { findOne: jest.fn() };
    const stub = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
        { provide: getRepositoryToken(Assignment), useValue: stub },
        { provide: getRepositoryToken(Duty), useValue: stub },
        { provide: getRepositoryToken(CleaningAssignment), useValue: stub },
        { provide: getRepositoryToken(FieldServiceMeeting), useValue: stub },
        { provide: getRepositoryToken(TalkExchange), useValue: stub },
        { provide: getRepositoryToken(ExternalCongregation), useValue: stub },
        { provide: getRepositoryToken(PublicTalk), useValue: stub },
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

  it('returns only the light identity fields when linked', async () => {
    publishersRepo.findOne.mockResolvedValue({
      id: 'p1',
      displayName: 'Adele B.',
      firstName: 'Adele',
      lastName: 'Backmann',
      pioneerType: 'none',
      serviceGroupId: 'g1',
      // Fields below must NOT leak into the response.
      email: 'private@example.org',
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
        serviceGroupId: 'g1',
      },
    });
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
        MeService,
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
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
