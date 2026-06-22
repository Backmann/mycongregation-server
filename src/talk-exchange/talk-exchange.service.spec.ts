import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TalkExchangeService } from './talk-exchange.service';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { TalkExchangeDirection } from '../common/enums/talk-exchange.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const TENANT = 'cong-1';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'me@example.org',
    role: UserRole.ADMIN,
    congregationId: TENANT,
    uiLanguage: 'en',
    ...overrides,
  };
}

describe('TalkExchangeService', () => {
  let service: TalkExchangeService;
  let repo: any;
  let assignmentRepo: any;
  let absenceRepo: any;
  let speakerRepo: any;
  let congregationRepo: any;
  let publicTalkRepo: any;
  let responsibilityRepo: any;

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: x.id ?? 'tx-1', ...x })),
      findOne: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };
    assignmentRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    absenceRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'abs-1', ...x })),
      findOne: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({}),
    };
    speakerRepo = { findOne: jest.fn() };
    congregationRepo = { findOne: jest.fn() };
    publicTalkRepo = { findOne: jest.fn() };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TalkExchangeService,
        { provide: getRepositoryToken(TalkExchange), useValue: repo },
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(Absence), useValue: absenceRepo },
        { provide: getRepositoryToken(VisitingSpeaker), useValue: speakerRepo },
        {
          provide: getRepositoryToken(ExternalCongregation),
          useValue: congregationRepo,
        },
        { provide: getRepositoryToken(PublicTalk), useValue: publicTalkRepo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(TalkExchangeService);
  });

  it('forbids a non-coordinator from creating', async () => {
    await expect(
      service.create(
        TENANT,
        { direction: TalkExchangeDirection.INCOMING, date: '2026-06-21' },
        user({ role: UserRole.PUBLISHER }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('auto-fills an empty weekend public-talk slot for an incoming entry', async () => {
    speakerRepo.findOne.mockResolvedValue({
      id: 'spk-1',
      firstName: 'Pavel',
      lastName: 'Petrov',
      externalCongregation: { name: 'Hamm Süd' },
    });
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg-1',
      publicTalkId: null,
      speakerName: null,
      status: 'draft',
    });

    const result = await service.create(
      TENANT,
      {
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-06-21',
        visitingSpeakerId: 'spk-1',
        publicTalkId: 'talk-1',
      },
      user(),
    );

    expect(assignmentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerName: 'Pavel Petrov',
        speakerCongregation: 'Hamm Süd',
        publicTalkId: 'talk-1',
      }),
    );
    expect(result.programConflict).toBeUndefined();
  });

  it('flags a conflict instead of overwriting an occupied slot', async () => {
    speakerRepo.findOne.mockResolvedValue({
      id: 'spk-1',
      firstName: 'Pavel',
      lastName: null,
      externalCongregation: null,
    });
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg-1',
      publicTalkId: 'other-talk',
      speakerName: 'Someone Else',
      status: 'published',
    });

    const result = await service.create(
      TENANT,
      {
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-06-21',
        visitingSpeakerId: 'spk-1',
        publicTalkId: 'talk-1',
      },
      user(),
    );

    expect(result.programConflict).toBe(true);
    expect(assignmentRepo.save).not.toHaveBeenCalled();
  });

  it('overwrites an occupied slot when overwriteProgram is set', async () => {
    speakerRepo.findOne.mockResolvedValue({
      id: 'spk-1',
      firstName: 'Pavel',
      lastName: null,
      externalCongregation: null,
    });
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg-1',
      publicTalkId: 'other',
      speakerName: 'X',
      status: 'published',
    });

    const result = await service.create(
      TENANT,
      {
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-06-21',
        visitingSpeakerId: 'spk-1',
        publicTalkId: 'talk-1',
        overwriteProgram: true,
      },
      user(),
    );

    expect(result.programConflict).toBeUndefined();
    expect(assignmentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        changedSincePublish: true,
        publicTalkId: 'talk-1',
      }),
    );
  });

  it('creates and links an absence for an outgoing entry', async () => {
    congregationRepo.findOne.mockResolvedValue({ id: 'ext-1', name: 'Ahlen' });
    publicTalkRepo.findOne.mockResolvedValue({ id: 'talk-1', number: 42 });

    const result = await service.create(
      TENANT,
      {
        direction: TalkExchangeDirection.OUTGOING,
        date: '2026-06-21',
        publisherId: 'pub-1',
        hostCongregationId: 'ext-1',
        publicTalkId: 'talk-1',
      },
      user(),
    );

    expect(absenceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publisherId: 'pub-1',
        startDate: '2026-06-21',
        note: '№42 · Ahlen',
      }),
    );
    expect(result.linkedAbsenceId).toBe('abs-1');
  });

  it('removes the linked absence on delete', async () => {
    repo.findOne.mockResolvedValue({
      id: 'tx-1',
      congregationId: TENANT,
      linkedAbsenceId: 'abs-1',
    });
    await service.remove(TENANT, 'tx-1', user());
    expect(absenceRepo.softDelete).toHaveBeenCalledWith('abs-1');
    expect(repo.softDelete).toHaveBeenCalledWith('tx-1');
  });
});
