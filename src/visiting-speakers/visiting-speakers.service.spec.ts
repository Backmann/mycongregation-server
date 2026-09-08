import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitingSpeakersService } from './visiting-speakers.service';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const TENANT = 'cong-1';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'me@example.org',
    role: UserRole.PUBLISHER,
    congregationId: TENANT,
    uiLanguage: 'en',
    ...overrides,
  };
}

describe('VisitingSpeakersService', () => {
  let service: VisitingSpeakersService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let responsibilityRepo: { count: jest.Mock };
  // Слияние переносит историю: подделки журнала речей и программы нужны
  // тестам, чтобы проверить, что она действительно переехала.
  let talkExchangeRepo: { update: jest.Mock };
  let assignmentRepo: { update: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'spk-1', ...x })),
      softDelete: jest.fn().mockResolvedValue({}),
    };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };
    talkExchangeRepo = { update: jest.fn().mockResolvedValue({}) };
    assignmentRepo = { update: jest.fn().mockResolvedValue({}) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VisitingSpeakersService,
        { provide: getRepositoryToken(VisitingSpeaker), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logRawUpdate: jest.fn(),
            logEvent: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TalkExchange),
          useValue: talkExchangeRepo,
        },
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
      ],
    }).compile();

    service = moduleRef.get(VisitingSpeakersService);
  });

  it('lets a coordinator create a speaker with a repertoire', async () => {
    responsibilityRepo.count.mockResolvedValue(1);
    const result = await service.create(
      TENANT,
      { firstName: 'Pavel', lastName: 'Petrov', talkNumbers: [12, 45] },
      user(),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      firstName: 'Pavel',
      talkNumbers: [12, 45],
      congregationId: TENANT,
    });
  });

  it('forbids a regular publisher from creating', async () => {
    responsibilityRepo.count.mockResolvedValue(0);
    await expect(
      service.create(TENANT, { firstName: 'Nope' }, user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists speakers with their home congregation', async () => {
    await service.findAll(TENANT);
    expect(repo.find).toHaveBeenCalledWith({
      // Объединённые в список не попадают: их визиты уже переехали, и
      // предлагать их к выбору значило бы разводить двойников заново.
      where: { congregationId: TENANT, mergedIntoId: IsNull() },
      relations: { externalCongregation: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  });

  it('throws when a speaker is not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(TENANT, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes on remove (as admin)', async () => {
    repo.findOne.mockResolvedValue({ id: 'spk-1', congregationId: TENANT });
    await service.remove(TENANT, 'spk-1', user({ role: UserRole.ADMIN }));
    expect(repo.softDelete).toHaveBeenCalledWith('spk-1');
  });

  /**
   * Один брат под двумя написаниями — «Иван Ротарюк» и «Rotariuk Iwan».
   * Слияние сводит их историю и оставляет след, по которому можно разъединить.
   */
  describe('объединение двойников', () => {
    const keep = () => ({
      id: 'keep-1',
      congregationId: TENANT,
      firstName: 'Иван',
      lastName: 'Ротарюк',
      phone: null,
      note: null,
      externalCongregationId: null,
      talkNumbers: [12, 45],
      autoCreated: true,
      mergedIntoId: null,
    });
    const other = () => ({
      id: 'merge-1',
      congregationId: TENANT,
      firstName: 'Iwan',
      lastName: 'Rotariuk',
      phone: '+49 170 000',
      note: null,
      externalCongregationId: 'ext-1',
      talkNumbers: [45, 99],
      autoCreated: false,
      mergedIntoId: null,
    });

    beforeEach(() => {
      responsibilityRepo.count.mockResolvedValue(1);
    });

    it('переносит визиты и слоты программы на оставшуюся карточку', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce({ ...keep(), talkNumbers: [12, 45, 99] });

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(talkExchangeRepo.update).toHaveBeenCalledWith(
        { congregationId: TENANT, visitingSpeakerId: 'merge-1' },
        { visitingSpeakerId: 'keep-1' },
      );
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        { congregationId: TENANT, visitingSpeakerId: 'merge-1' },
        { visitingSpeakerId: 'keep-1' },
      );
    });

    it('складывает репертуар и заполняет пустое', async () => {
      // Речь, которую он говорил, остаётся его речью, под каким бы написанием
      // имени её ни записали. Телефон и собрание были только у второй карточки.
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce(keep());

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'keep-1',
          talkNumbers: [12, 45, 99],
          phone: '+49 170 000',
          externalCongregationId: 'ext-1',
          autoCreated: false,
        }),
      );
    });

    it('оставляет след вместо удаления', async () => {
      // Решение Лионеля: если через месяц окажется, что это разные братья,
      // разъединять должно быть по чему.
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce(keep());

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'merge-1', mergedIntoId: 'keep-1' }),
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('отказывает, когда карточку сливают саму с собой', async () => {
      await expect(
        service.merge(TENANT, user(), 'keep-1', 'keep-1'),
      ).rejects.toMatchObject({ response: { code: 'SAME_CARD' } });
    });

    it('отказывает, когда одна из карточек уже объединена', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce({ ...other(), mergedIntoId: 'someone' });

      await expect(
        service.merge(TENANT, user(), 'keep-1', 'merge-1'),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_MERGED' } });
      expect(talkExchangeRepo.update).not.toHaveBeenCalled();
    });

    it('не пускает того, кто не ведёт речи', async () => {
      responsibilityRepo.count.mockResolvedValue(0);

      await expect(
        service.merge(TENANT, user({ role: UserRole.PUBLISHER }), 'a', 'b'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
