import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitingSpeakersService } from './visiting-speakers.service';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { VisitingSpeakerDistinctPair } from '../entities/visiting-speaker-distinct-pair.entity';
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
    manager: { transaction: jest.Mock };
  };
  let auditLog: { logUpdate: jest.Mock };
  let distinctRepo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
  let responsibilityRepo: { count: jest.Mock };
  // Слияние переносит историю: подделки журнала речей и программы нужны
  // тестам, чтобы проверить, что она действительно переехала.
  let talkExchangeRepo: { update: jest.Mock; find: jest.Mock };
  let assignmentRepo: { update: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'spk-1', ...x })),
      softDelete: jest.fn().mockResolvedValue({}),
      // Объединение и разъединение идут одной операцией; подделка отдаёт
      // внутрь те же хранилища, что и снаружи.
      manager: {
        transaction: jest.fn((fn: (m: unknown) => unknown) =>
          fn({
            getRepository: (e: unknown) =>
              e === VisitingSpeaker
                ? repo
                : e === TalkExchange
                  ? talkExchangeRepo
                  : e === Assignment
                    ? assignmentRepo
                    : distinctRepo,
          }),
        ),
      },
    };
    distinctRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    (distinctRepo as unknown as { create: unknown }).create = (x: unknown) => x;
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };
    talkExchangeRepo = {
      update: jest.fn().mockResolvedValue({ affected: 2 }),
      find: jest.fn().mockResolvedValue([{ id: 'ex-1' }, { id: 'ex-2' }]),
    };
    assignmentRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([{ id: 'as-1' }]),
    };

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
          useValue: (auditLog = {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logRawUpdate: jest.fn(),
            logEvent: jest.fn(),
          } as never),
        },
        {
          provide: getRepositoryToken(TalkExchange),
          useValue: talkExchangeRepo,
        },
        { provide: getRepositoryToken(Assignment), useValue: assignmentRepo },
        {
          provide: getRepositoryToken(VisitingSpeakerDistinctPair),
          useValue: distinctRepo,
        },
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
    it('записывает, ЧТО переехало, — иначе разъединять не по чему', async () => {
      // После объединения визиты двух братьев лежат у одной карточки и
      // неотличимы. Запись делается до переезда и остаётся на объединённой.
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce(keep());

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'merge-1',
          mergeRecord: expect.objectContaining({
            exchangeIds: ['ex-1', 'ex-2'],
            assignmentIds: ['as-1'],
            addedTalkNumbers: [99],
            filled: ['phone', 'externalCongregationId'],
            keepWasAutoCreated: true,
            byUserId: 'user-1',
          }),
        }),
      );
    });

    it('идёт одной операцией', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce(keep());

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('пишет в журнал оба имени, а не номера карточек', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(other())
        .mockResolvedValueOnce(keep());

      await service.merge(TENANT, user(), 'keep-1', 'merge-1');

      expect(auditLog.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'keep-1',
          actorUserId: 'user-1',
          after: expect.objectContaining({
            mergedFrom: 'Иван Ротарюк ← Iwan Rotariuk',
            movedVisits: 2,
          }),
        }),
      );
    });
  });

  /**
   * Это были разные братья. Возвращается ровно то, что переехало, — по записи,
   * сделанной при объединении (5 октября 2026).
   */
  describe('разъединение', () => {
    const record = () => ({
      at: '2026-10-05T10:00:00.000Z',
      byUserId: 'user-1',
      exchangeIds: ['ex-1', 'ex-2'],
      assignmentIds: ['as-1'],
      addedTalkNumbers: [99],
      filled: ['phone', 'externalCongregationId'] as Array<
        'phone' | 'note' | 'externalCongregationId'
      >,
      keepWasAutoCreated: true,
    });
    const keep = () => ({
      id: 'keep-1',
      congregationId: TENANT,
      firstName: 'Иван',
      lastName: 'Ротарюк',
      phone: '+49 170 000',
      note: null,
      externalCongregationId: 'ext-1',
      talkNumbers: [12, 45, 99],
      autoCreated: false,
      mergedIntoId: null,
      mergeRecord: null,
    });
    const merged = () => ({
      id: 'merge-1',
      congregationId: TENANT,
      firstName: 'Iwan',
      lastName: 'Rotariuk',
      phone: '+49 170 000',
      note: null,
      externalCongregationId: 'ext-1',
      talkNumbers: [45, 99],
      autoCreated: false,
      mergedIntoId: 'keep-1',
      mergeRecord: record(),
    });

    beforeEach(() => {
      responsibilityRepo.count.mockResolvedValue(1);
    });

    it('возвращает переехавшие визиты и слоты — и только те, что ещё у оставшейся', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(merged())
        .mockResolvedValueOnce(keep());

      await service.unmerge(TENANT, user(), 'keep-1', 'merge-1');

      // Условие «всё ещё у оставшейся»: запись, отданную с тех пор третьему
      // докладчику, разъединение не трогает.
      expect(talkExchangeRepo.update).toHaveBeenCalledWith(
        {
          congregationId: TENANT,
          visitingSpeakerId: 'keep-1',
          id: In(['ex-1', 'ex-2']),
        },
        { visitingSpeakerId: 'merge-1' },
      );
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        {
          congregationId: TENANT,
          visitingSpeakerId: 'keep-1',
          id: In(['as-1']),
        },
        { visitingSpeakerId: 'merge-1' },
      );
    });

    it('снимает с оставшейся то, что пришло с объединённой', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(merged())
        .mockResolvedValueOnce(keep());

      await service.unmerge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'keep-1',
          talkNumbers: [12, 45],
          phone: null,
          externalCongregationId: null,
          autoCreated: true,
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'merge-1',
          mergedIntoId: null,
          mergeRecord: null,
        }),
      );
    });

    it('не трогает сведения, которые с тех пор исправили руками', async () => {
      // Телефон поменяли уже после объединения — это сведения оставшейся.
      repo.findOne
        .mockResolvedValueOnce({ ...keep(), phone: '+49 151 999' })
        .mockResolvedValueOnce(merged())
        .mockResolvedValueOnce(keep());

      await service.unmerge(TENANT, user(), 'keep-1', 'merge-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'keep-1', phone: '+49 151 999' }),
      );
    });

    it('запоминает пару как «разные братья», чтобы её не предложили снова', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(merged())
        .mockResolvedValueOnce(keep());

      await service.unmerge(TENANT, user(), 'keep-1', 'merge-1');

      expect(distinctRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          speakerAId: 'keep-1',
          speakerBId: 'merge-1',
        }),
      );
    });

    it('пишет в журнал, с кем разъединили и сколько визитов вернулось', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce(merged())
        .mockResolvedValueOnce(keep());

      await service.unmerge(TENANT, user(), 'keep-1', 'merge-1');

      expect(auditLog.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'keep-1',
          after: expect.objectContaining({
            separatedFrom: 'Иван Ротарюк ↔ Iwan Rotariuk',
            returnedVisits: 2,
          }),
        }),
      );
    });

    it('отказывает для объединения, сделанного до записи', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce({ ...merged(), mergeRecord: null });

      await expect(
        service.unmerge(TENANT, user(), 'keep-1', 'merge-1'),
      ).rejects.toMatchObject({ response: { code: 'NO_MERGE_RECORD' } });
      expect(talkExchangeRepo.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('отказывает, когда карточка объединена не с этой', async () => {
      repo.findOne
        .mockResolvedValueOnce(keep())
        .mockResolvedValueOnce({ ...merged(), mergedIntoId: 'someone-else' });

      await expect(
        service.unmerge(TENANT, user(), 'keep-1', 'merge-1'),
      ).rejects.toMatchObject({ response: { code: 'NOT_MERGED_HERE' } });
    });

    it('не пускает того, кто не ведёт речи', async () => {
      responsibilityRepo.count.mockResolvedValue(0);

      await expect(
        service.unmerge(TENANT, user(), 'keep-1', 'merge-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('показывает объединённые карточки и можно ли их разобрать', async () => {
      repo.find.mockResolvedValue([
        merged(),
        { ...merged(), id: 'old-1', mergeRecord: null },
      ]);

      const list = await service.listMerged(TENANT, 'keep-1');

      expect(list).toEqual([
        expect.objectContaining({ id: 'merge-1', visits: 2, canUnmerge: true }),
        expect.objectContaining({
          id: 'old-1',
          visits: null,
          canUnmerge: false,
        }),
      ]);
    });
  });

  /** «Это разные братья»: подсказка о двойниках замолкает — для всех. */
  describe('разные братья', () => {
    const card = (id: string, firstName: string) => ({
      id,
      congregationId: TENANT,
      firstName,
      lastName: 'Шмидт',
    });

    beforeEach(() => {
      responsibilityRepo.count.mockResolvedValue(1);
    });

    it('хранит пару в одном порядке, в каком бы её ни назвали', async () => {
      repo.findOne
        .mockResolvedValueOnce(card('b-2', 'Андреас'))
        .mockResolvedValueOnce(card('a-1', 'Andreas'));

      await service.markDistinct(TENANT, user(), 'b-2', 'a-1');

      expect(distinctRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          congregationId: TENANT,
          speakerAId: 'a-1',
          speakerBId: 'b-2',
          createdByUserId: 'user-1',
        }),
      );
    });

    it('не записывает пару дважды', async () => {
      repo.findOne
        .mockResolvedValueOnce(card('a-1', 'Andreas'))
        .mockResolvedValueOnce(card('b-2', 'Андреас'));
      distinctRepo.findOne.mockResolvedValue({ id: 'there' });

      await service.markDistinct(TENANT, user(), 'a-1', 'b-2');

      expect(distinctRepo.save).not.toHaveBeenCalled();
      expect(auditLog.logUpdate).not.toHaveBeenCalled();
    });

    it('отказывает для чужой или несуществующей карточки', async () => {
      repo.findOne
        .mockResolvedValueOnce(card('a-1', 'Andreas'))
        .mockResolvedValueOnce(null);

      await expect(
        service.markDistinct(TENANT, user(), 'a-1', 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('не пускает того, кто не ведёт речи', async () => {
      responsibilityRepo.count.mockResolvedValue(0);

      await expect(
        service.markDistinct(TENANT, user(), 'a-1', 'b-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(distinctRepo.save).not.toHaveBeenCalled();
    });

    it('отдаёт пары списком', async () => {
      distinctRepo.find.mockResolvedValue([
        { speakerAId: 'a-1', speakerBId: 'b-2' },
      ]);

      expect(await service.listDistinct(TENANT)).toEqual([['a-1', 'b-2']]);
    });
  });
});
