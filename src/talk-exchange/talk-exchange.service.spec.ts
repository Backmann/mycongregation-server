// The notifications chain reaches the push SDK, which ships as ESM only.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { TalkExchangeService } from './talk-exchange.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SpecialTalkNotificationsService } from './special-talk-notifications.service';
import { OutgoingTalkNotificationsService } from './outgoing-talk-notifications.service';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
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
  // Журнал изменений: замена обязана оставлять в нём след, значит подделка
  // должна быть доступна тестам, а не спрятана в объявлении модуля.
  let auditLog: any;
  let specialTalkNotifications: any;
  // Визиты районного: пусто, пока случай не скажет иначе.
  let eventRepo: any;

  beforeEach(async () => {
    eventRepo = { find: jest.fn().mockResolvedValue([]) };
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
      // Удалённое отсутствие теперь восстанавливается, а не заводится заново.
      restore: jest.fn().mockResolvedValue({}),
    };
    speakerRepo = {
      findOne: jest.fn(),
      // Справочник приезжих: программа теперь заводит карточку по имени,
      // поэтому подделке нужны и поиск списком, и сохранение.
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'speaker-new', ...x })),
    };
    congregationRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    publicTalkRepo = { findOne: jest.fn() };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };
    specialTalkNotifications = { announceIfNew: jest.fn(async () => {}) };
    auditLog = {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logEvent: jest.fn(),
    };

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
        {
          provide: getRepositoryToken(MeetingSettings),
          useValue: {
            find: jest
              .fn()
              .mockResolvedValue([
                { effectiveFrom: '2020-01-06', weekendDow: 7 },
              ]),
          },
        },
        {
          provide: AuditLogService,
          useValue: auditLog,
        },
        { provide: getRepositoryToken(SpecialEvent), useValue: eventRepo },
        {
          provide: SpecialTalkNotificationsService,
          useValue: specialTalkNotifications,
        },
        {
          provide: OutgoingTalkNotificationsService,
          useValue: { announce: jest.fn() },
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

  it('пускает помощника координатора речей', async () => {
    /**
     * Замену делают за минуты до встречи, и координатора может не быть рядом:
     * он в отъезде, он сам докладчик, он просто не подошёл. Пока право было
     * только у него, программа на сцене оставалась неверной.
     */
    responsibilityRepo.count.mockImplementation(
      async (opts: { where: { type: { _value: string[] } } }) => {
        const types = opts.where.type._value;
        return types.includes('public_talk_coordinator_assistant') ? 1 : 0;
      },
    );

    await expect(
      service.create(
        TENANT,
        { direction: TalkExchangeDirection.INCOMING, date: '2026-06-21' },
        user({ role: UserRole.PUBLISHER }),
      ),
    ).resolves.toBeDefined();
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

  it('auto-fills the slot from free-text speaker when not in the directory', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg-1',
      publicTalkId: null,
      speakerName: null,
      status: 'draft',
    });

    await service.create(
      TENANT,
      {
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-06-21',
        speakerName: 'Guest Brother',
        speakerCongregation: 'Some Town',
        publicTalkId: 'talk-1',
      },
      user(),
    );

    expect(speakerRepo.findOne).not.toHaveBeenCalled();
    expect(assignmentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerName: 'Guest Brother',
        speakerCongregation: 'Some Town',
        publicTalkId: 'talk-1',
      }),
    );
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
    // Обратная ссылка: по ней экран объясняет причину и не даёт убрать
    // отсутствие в обход поездки.
    expect(absenceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ talkExchangeId: expect.anything() }),
    );
  });

  it('возвращает удалённое отсутствие, а не заводит новое', async () => {
    /**
     * Обычный поиск не видит удалённых, и прежде это значило: не нашли —
     * создали следующее. Брат убирал, приложение возвращало другое, и спор шёл
     * по кругу — так 8 сентября вернулись два отсутствия одного брата. Теперь
     * возвращается та же запись, со своей историей и своим номером.
     */
    responsibilityRepo.count.mockResolvedValue(1);
    repo.findOne.mockResolvedValue({
      id: 'tx-1',
      congregationId: TENANT,
      direction: TalkExchangeDirection.OUTGOING,
      date: '2026-06-21',
      publisherId: 'pub-1',
      linkedAbsenceId: 'abs-1',
    });
    absenceRepo.findOne.mockResolvedValue({
      id: 'abs-1',
      congregationId: TENANT,
      deletedAt: new Date('2026-06-01'),
    });

    await service.update(TENANT, 'tx-1', { note: 'что-нибудь' }, user());

    expect(absenceRepo.restore).toHaveBeenCalledWith('abs-1');
    expect(absenceRepo.create).not.toHaveBeenCalled();
    // И сам запрос обязан спрашивать удалённые: без этого поиск не нашёл бы
    // запись, и всё вернулось бы к заведению новой. Подделка отдаёт её в любом
    // случае, поэтому проверяется запрос, а не ответ.
    expect(absenceRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('clears our own brother from the programme when this entry put him there', async () => {
    // The reported bug: the entry was deleted from the coordinator's journal
    // but the brother stayed on the weekend programme.
    repo.findOne.mockResolvedValue({
      id: 'tx-1',
      congregationId: TENANT,
      direction: 'incoming',
      date: '2026-08-23',
      publisherId: 'pub-7',
      publicTalkId: 'talk-1',
    });
    const slot = {
      id: 'as-1',
      publisherId: 'pub-7',
      publicTalkId: 'talk-1',
      speakerName: null,
      partTitle: '№114. Ценить чудеса',
      status: 'draft',
    };
    assignmentRepo.findOne.mockResolvedValue(slot);

    await service.remove(TENANT, 'tx-1', user());

    expect(assignmentRepo.save).toHaveBeenCalled();
    expect(slot.publisherId).toBeNull();
    expect(slot.publicTalkId).toBeNull();
    expect(slot.partTitle).toBeNull();
  });

  it('leaves a brother alone when somebody else assigned him', async () => {
    // The guard this replaced existed for exactly this case, and it still holds.
    repo.findOne.mockResolvedValue({
      id: 'tx-1',
      congregationId: TENANT,
      direction: 'incoming',
      date: '2026-08-23',
      publisherId: 'pub-7',
      publicTalkId: 'talk-1',
    });
    const slot = {
      id: 'as-1',
      publisherId: 'someone-else',
      publicTalkId: 'talk-9',
      speakerName: null,
      partTitle: 'чужое',
      status: 'draft',
    };
    assignmentRepo.findOne.mockResolvedValue(slot);

    await service.remove(TENANT, 'tx-1', user());

    expect(assignmentRepo.save).not.toHaveBeenCalled();
    expect(slot.publisherId).toBe('someone-else');
  });

  it('still clears an invited speaker, as it always did', async () => {
    repo.findOne.mockResolvedValue({
      id: 'tx-1',
      congregationId: TENANT,
      direction: 'incoming',
      date: '2026-08-23',
      publisherId: null,
      publicTalkId: 'talk-1',
    });
    const slot = {
      id: 'as-1',
      publisherId: null,
      publicTalkId: 'talk-1',
      speakerName: 'Гость',
      partTitle: 'что-то',
      status: 'draft',
    };
    assignmentRepo.findOne.mockResolvedValue(slot);

    await service.remove(TENANT, 'tx-1', user());

    expect(slot.speakerName).toBeNull();
    expect(slot.publicTalkId).toBeNull();
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

  it('syncs an invited program speaker into a journal incoming entry', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg',
      publisherId: null,
      speakerName: 'Guest X',
      speakerCongregation: 'Town',
      publicTalkId: 'talk-1',
    });
    repo.findOne.mockResolvedValue(null); // no existing journal entry

    await service.syncProgramToJournal(TENANT, '2026-06-15');

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: TalkExchangeDirection.INCOMING,
        speakerName: 'Guest X',
        speakerCongregation: 'Town',
        publicTalkId: 'talk-1',
      }),
    );
  });

  // 26 September: the journal took the weekday of the LATEST schedule
  // version, so a change planned for January moved this summer's entries.
  it('dates a journal entry by the schedule in force that week, not a later one', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg',
      publisherId: null,
      speakerName: 'Guest X',
      speakerCongregation: 'Town',
      publicTalkId: 'talk-1',
    });
    repo.findOne.mockResolvedValue(null);
    (service as any).meetingSettingsRepo.find.mockResolvedValue([
      { effectiveFrom: '2027-01-04', weekendDow: 6 },
      { effectiveFrom: '2020-01-06', weekendDow: 7 },
    ]);

    await service.syncProgramToJournal(TENANT, '2026-06-15');

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-21' }),
    );
  });

  /**
   * Чей это визит — вопрос, на который приложение раньше теряло ответ.
   *
   * История брата считается по связи записи с его карточкой. Программа знала
   * только имя текстом, поэтому зеркало «программа → журнал» не узнавало
   * привязанную запись и стирало связь. Запись оставалась, имя оставалось, а
   * визит переставал принадлежать человеку: «ещё не приезжал», обнулённый
   * промежуток, речь снова непроизнесённая.
   */
  /**
   * Замена в день встречи: приехал не тот, кого ждали.
   *
   * Раньше это делалось правкой имени, и первый брат исчезал бесследно.
   * Теперь это два факта, и оба остаются.
   */
  describe('замена докладчика', () => {
    const week = '2026-06-15';
    const slot = () => ({
      id: 'asg',
      publisherId: null,
      visitingSpeakerId: 'speaker-old',
      speakerName: 'Walter Getko',
      speakerCongregation: 'Arnsberg',
      publicTalkId: 'talk-1',
      status: 'draft',
    });

    it('закрывает прежний визит как несостоявшийся, а не стирает его', async () => {
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue({
        id: 'tx-old',
        publisherId: null,
        visitingSpeakerId: 'speaker-old',
        speakerName: 'Walter Getko',
        status: 'confirmed',
        note: null,
      });
      speakerRepo.findOne.mockResolvedValue({
        id: 'speaker-new-1',
        firstName: 'Iwan',
        lastName: 'Schustov',
        externalCongregation: { name: 'Bielefeld' },
      });

      const out = await service.replaceSpeaker(TENANT, user(), {
        weekStartDate: week,
        visitingSpeakerId: 'speaker-new-1',
        reason: 'заболел',
      });

      expect(out.closed).toBe('tx-old');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx-old',
          status: 'did_not_happen',
          note: 'заболел',
        }),
      );
      // Запись НЕ удалена: по ней потом решают, звать ли снова.
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('ставит нового докладчика в программу немедленно', async () => {
      // Председатель объявляет то, что написано в программе, и написано это
      // должно быть до того, как он выйдет на сцену.
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue(null);
      speakerRepo.findOne.mockResolvedValue({
        id: 'speaker-new-1',
        firstName: 'Iwan',
        lastName: 'Schustov',
        externalCongregation: { name: 'Bielefeld' },
      });

      await service.replaceSpeaker(TENANT, user(), {
        weekStartDate: week,
        visitingSpeakerId: 'speaker-new-1',
      });

      expect(assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          visitingSpeakerId: 'speaker-new-1',
          speakerName: 'Iwan Schustov',
          speakerCongregation: 'Bielefeld',
        }),
      );
    });

    it('заводит карточку, когда заменяющего вписали именем', async () => {
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue(null);

      await service.replaceSpeaker(TENANT, user(), {
        weekStartDate: week,
        speakerName: 'Sergej Konkow',
        speakerCongregation: 'Münster',
      });

      expect(speakerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Sergej', autoCreated: true }),
      );
      expect(assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'speaker-new' }),
      );
    });

    it('закрывает визит и НАШЕГО брата тоже', async () => {
      /**
       * Сначала своего не закрывали: он ведь никуда не ездил. Неверно дважды.
       * По сути — «наш брат не смог, вместо него другой» тот же самый факт:
       * назначен и не выступил. По последствиям — без закрытой записи нечего
       * возвращать, и замена становилась необратимой; так 7 сентября неделя
       * потеряла докладчика и тему безвозвратно.
       */
      assignmentRepo.findOne.mockResolvedValue({
        ...slot(),
        publisherId: 'pub-1',
        visitingSpeakerId: null,
        speakerName: null,
      });
      repo.findOne.mockResolvedValue({
        id: 'tx-local',
        publisherId: 'pub-1',
        status: 'confirmed',
        note: null,
      });
      speakerRepo.findOne.mockResolvedValue({
        id: 'speaker-new-1',
        firstName: 'Iwan',
        lastName: null,
        externalCongregation: null,
      });

      const out = await service.replaceSpeaker(TENANT, user(), {
        weekStartDate: week,
        visitingSpeakerId: 'speaker-new-1',
      });

      expect(out.closed).toBe('tx-local');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx-local', status: 'did_not_happen' }),
      );
    });

    it('оставляет след в журнале изменений', async () => {
      /**
       * Обычная правка назначения след оставляет, а замена правила слот
       * напрямую и молча — поэтому у испорченной недели не нашлось ни следа,
       * ни возможности вернуть как было.
       */
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue(null);
      speakerRepo.findOne.mockResolvedValue({
        id: 'speaker-new-1',
        firstName: 'Iwan',
        lastName: null,
        externalCongregation: null,
      });

      await service.replaceSpeaker(TENANT, user(), {
        weekStartDate: week,
        visitingSpeakerId: 'speaker-new-1',
      });

      expect(auditLog.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'assignment',
          entityId: 'asg',
          before: expect.objectContaining({ visitingSpeakerId: 'speaker-old' }),
          after: expect.objectContaining({
            visitingSpeakerId: 'speaker-new-1',
          }),
        }),
      );
    });

    it('отказывает, когда в неделе нет слота публичной речи', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.replaceSpeaker(TENANT, user(), {
          weekStartDate: week,
          speakerName: 'Кто-то',
        }),
      ).rejects.toThrow();
    });

    it('отказывает, когда некого поставить', async () => {
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.replaceSpeaker(TENANT, user(), { weekStartDate: week }),
      ).rejects.toThrow();
    });
  });

  /**
   * Возврат замены: отметка «не приехал» верна ровно пока она правда.
   */
  describe('отмена замены', () => {
    const closed = () => ({
      id: 'tx-closed',
      congregationId: TENANT,
      date: '2026-06-21',
      status: 'did_not_happen',
      publisherId: null,
      visitingSpeakerId: 'speaker-old',
      speakerName: 'Walter Getko',
      speakerCongregation: 'Arnsberg',
      publicTalkId: 'talk-1',
      hospitalityPublisherId: null,
      note: null,
    });

    it('возвращает визит и убирает запись заменившего', async () => {
      repo.findOne.mockResolvedValueOnce(closed()).mockResolvedValueOnce({
        id: 'tx-live',
        hospitalityPublisherId: null,
        note: null,
      });
      assignmentRepo.findOne.mockResolvedValue({ id: 'asg', status: 'draft' });
      publicTalkRepo.findOne.mockResolvedValue({
        id: 'talk-1',
        number: 65,
        title: 'Как развивать миролюбие',
      });

      const out = await service.undoReplacement(TENANT, user(), 'tx-closed');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx-closed', status: 'confirmed' }),
      );
      expect(repo.softDelete).toHaveBeenCalledWith('tx-live');
      expect(out.removed).toBe('tx-live');
      // Программа снова его: председатель прочитает верное имя.
      expect(assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          visitingSpeakerId: 'speaker-old',
          speakerName: 'Walter Getko',
          publicTalkId: 'talk-1',
        }),
      );
    });

    it('не трогает запись заменившего, если в ней есть заметка', async () => {
      // Заметка — решение человека, а не след замены: выбрасывать её нельзя.
      repo.findOne.mockResolvedValueOnce(closed()).mockResolvedValueOnce({
        id: 'tx-live',
        hospitalityPublisherId: null,
        note: 'договорились о ночлеге',
      });
      assignmentRepo.findOne.mockResolvedValue(null);

      const out = await service.undoReplacement(TENANT, user(), 'tx-closed');

      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(out.removed).toBeNull();
    });

    it('везёт гостеприимство обратно к вернувшемуся', async () => {
      /**
       * Приём принадлежит НЕДЕЛЕ, а не человеку: семья принимает гостя, кем бы
       * он ни был. Поэтому при замене он переезжает к приехавшему, а при
       * возврате — обратно, и запись заменившего это на месте не держит.
       */
      repo.findOne.mockResolvedValueOnce(closed()).mockResolvedValueOnce({
        id: 'tx-live',
        hospitalityPublisherId: 'pub-7',
        note: null,
      });
      assignmentRepo.findOne.mockResolvedValue(null);

      const out = await service.undoReplacement(TENANT, user(), 'tx-closed');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tx-closed',
          hospitalityPublisherId: 'pub-7',
        }),
      );
      expect(out.removed).toBe('tx-live');
    });

    it('отказывает, когда визит не был помечен несостоявшимся', async () => {
      repo.findOne.mockResolvedValueOnce({ ...closed(), status: 'confirmed' });

      await expect(
        service.undoReplacement(TENANT, user(), 'tx-closed'),
      ).rejects.toMatchObject({ response: { code: 'NOT_A_MISSED_VISIT' } });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('связь со справочником', () => {
    it('зеркало не видит несостоявшихся записей', async () => {
      // Иначе после замены оно взяло бы закрытую запись первого брата и
      // переписало её именем второго — потеря истории с другой стороны.
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: 'Walter Getko',
        speakerCongregation: null,
        publicTalkId: 'talk-1',
        visitingSpeakerId: 'speaker-7',
      });
      repo.findOne.mockResolvedValue(null);

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      expect(Object.keys(repo.findOne.mock.calls[0][0].where)).toContain(
        'status',
      );
    });

    it('не теряет привязку записи, когда программа отражается в журнал', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: 'Walter Getko',
        speakerCongregation: 'Arnsberg',
        publicTalkId: 'talk-1',
        visitingSpeakerId: 'speaker-7',
      });
      repo.findOne.mockResolvedValue({
        id: 'tx-1',
        publisherId: null,
        visitingSpeakerId: 'speaker-7',
        speakerName: 'Walter Getko',
        speakerCongregation: 'Arnsberg',
        publicTalkId: 'talk-1',
      });

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      // Ничего не изменилось — значит и переписывать нечего.
      expect(repo.save).not.toHaveBeenCalled();
      expect(speakerRepo.save).not.toHaveBeenCalled();
    });

    it('заводит карточку, когда имя напечатали руками', async () => {
      // Так визит попадает в историю брата, даже если координатор никогда не
      // открывал справочник.
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: 'Walter Getko',
        speakerCongregation: 'Arnsberg',
        publicTalkId: 'talk-1',
        visitingSpeakerId: null,
      });
      repo.findOne.mockResolvedValue(null);

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      expect(speakerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Walter',
          lastName: 'Getko',
          autoCreated: true,
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'speaker-new' }),
      );
    });

    it('берёт существующую карточку, а не плодит вторую', async () => {
      // Совпало имя без учёта регистра и лишних пробелов И то же собрание.
      speakerRepo.find.mockResolvedValue([
        {
          id: 'speaker-7',
          firstName: 'Walter',
          lastName: 'Getko',
          externalCongregationId: 'ext-1',
        },
      ]);
      congregationRepo.find.mockResolvedValue([
        { id: 'ext-1', name: 'Arnsberg' },
      ]);
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: '  walter   getko ',
        speakerCongregation: 'arnsberg',
        publicTalkId: 'talk-1',
        visitingSpeakerId: null,
      });
      repo.findOne.mockResolvedValue(null);

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      expect(speakerRepo.save).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'speaker-7' }),
      );
    });

    it('не приклеивает визит к тёзке из другого собрания', async () => {
      // Тёзки обычны. Склеить двух братьев молча хуже, чем завести лишнюю
      // карточку: лишнюю видно и можно слить, а склейку — нет.
      speakerRepo.find.mockResolvedValue([
        {
          id: 'speaker-7',
          firstName: 'Walter',
          lastName: 'Getko',
          externalCongregationId: 'ext-1',
        },
      ]);
      congregationRepo.find.mockResolvedValue([
        { id: 'ext-1', name: 'Arnsberg' },
        { id: 'ext-2', name: 'Soest' },
      ]);
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: 'Walter Getko',
        speakerCongregation: 'Soest',
        publicTalkId: 'talk-1',
        visitingSpeakerId: null,
      });
      repo.findOne.mockResolvedValue(null);

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      expect(speakerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ externalCongregationId: 'ext-2' }),
      );
    });

    it('запоминает найденную карточку в самом слоте', async () => {
      // Иначе на каждое сохранение недели поиск повторялся бы, а при малейшем
      // расхождении заводил бы новую карточку.
      assignmentRepo.findOne.mockResolvedValue({
        id: 'asg',
        publisherId: null,
        speakerName: 'Walter Getko',
        speakerCongregation: null,
        publicTalkId: 'talk-1',
        visitingSpeakerId: null,
      });
      repo.findOne.mockResolvedValue(null);

      await service.syncProgramToJournal(TENANT, '2026-06-15');

      expect(assignmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'speaker-new' }),
      );
    });
  });

  it('keeps the journal entry as a local brother when the slot has a publisher', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg',
      publisherId: 'pub-1', // local brother
      speakerName: null,
      publicTalkId: 'talk-1',
    });
    repo.findOne.mockResolvedValue({ id: 'tx-9' });

    await service.syncProgramToJournal(TENANT, '2026-06-15');

    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tx-9',
        publisherId: 'pub-1',
        speakerName: null,
        publicTalkId: 'talk-1',
      }),
    );
  });

  it('removes the journal entry when the slot week is CANCELLED', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg',
      publisherId: 'pub-1',
      speakerName: null,
      publicTalkId: 'talk-1',
      status: 'cancelled',
    });
    repo.findOne.mockResolvedValue({ id: 'tx-9' });

    await service.syncProgramToJournal(TENANT, '2026-06-15');

    expect(repo.softDelete).toHaveBeenCalledWith('tx-9');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('removes the journal entry when the program slot has no speaker', async () => {
    assignmentRepo.findOne.mockResolvedValue({
      id: 'asg',
      publisherId: null,
      speakerName: null,
      publicTalkId: null,
    });
    repo.findOne.mockResolvedValue({ id: 'tx-9' });

    await service.syncProgramToJournal(TENANT, '2026-06-15');

    expect(repo.softDelete).toHaveBeenCalledWith('tx-9');
  });

  /**
   * Районный в журнале «К нам» (5 октября).
   *
   * Его публичная речь — тоже приезд докладчика. Раньше запись появлялась
   * случайно, карточка была обычной, а после удаления визита журнал продолжал
   * говорить, что он приедет.
   */
  describe('районный старейшина', () => {
    const WEEK = '2026-10-12';
    const visit = (over: Record<string, unknown> = {}) => ({
      id: 'visit-1',
      type: 'circuit_overseer_visit',
      date: '2026-10-13',
      coFirstName: 'Иван',
      coLastName: 'Тестов',
      deletedAt: null,
      ...over,
    });
    const slot = (over: Record<string, unknown> = {}) => ({
      id: 'asg',
      publisherId: null,
      speakerName: 'Иван Тестов',
      speakerCongregation: null,
      publicTalkId: null,
      visitingSpeakerId: null,
      ...over,
    });
    beforeEach(() => {
      repo.count = jest.fn().mockResolvedValue(0);
      repo.restore = jest.fn().mockResolvedValue({});
      eventRepo.find.mockResolvedValue([visit()]);
      assignmentRepo.findOne.mockResolvedValue(slot());
      repo.findOne.mockResolvedValue(null);
    });

    it('получает запись «К нам» и помеченную карточку', async () => {
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(speakerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Иван',
          lastName: 'Тестов',
          circuitOverseer: true,
          autoCreated: true,
          externalCongregationId: null,
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'incoming',
          speakerName: 'Иван Тестов',
          visitingSpeakerId: 'speaker-new',
        }),
      );
    });

    it('в неделю без визита ничего не делает', async () => {
      eventRepo.find.mockResolvedValue([visit({ date: '2026-11-03' })]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(assignmentRepo.findOne).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(speakerRepo.save).not.toHaveBeenCalled();
    });

    it('берёт уже помеченную карточку, а не заводит вторую', async () => {
      speakerRepo.find.mockResolvedValue([
        {
          id: 'co-card',
          firstName: 'иван',
          lastName: 'ТЕСТОВ',
          externalCongregationId: null,
          circuitOverseer: true,
        },
      ]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(speakerRepo.save).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'co-card' }),
      );
    });

    it('помечает карточку без собрания, заведённую до появления пометки', async () => {
      const old = {
        id: 'old-card',
        firstName: 'Иван',
        lastName: 'Тестов',
        externalCongregationId: null,
        circuitOverseer: false,
      };
      speakerRepo.find.mockResolvedValue([old]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(old.circuitOverseer).toBe(true);
      expect(speakerRepo.save).toHaveBeenCalledWith(old);
      expect(speakerRepo.create).not.toHaveBeenCalled();
    });

    it('тёзку из собрания районным не делает — заводит свою карточку', async () => {
      const namesake = {
        id: 'namesake',
        firstName: 'Иван',
        lastName: 'Тестов',
        externalCongregationId: 'ext-1',
        circuitOverseer: false,
      };
      speakerRepo.find.mockResolvedValue([namesake]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(namesake.circuitOverseer).toBe(false);
      expect(speakerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ circuitOverseer: true, autoCreated: true }),
      );
    });

    it('объединённую карточку не берёт', async () => {
      speakerRepo.find.mockResolvedValue([
        {
          id: 'merged-away',
          firstName: 'Иван',
          lastName: 'Тестов',
          externalCongregationId: null,
          circuitOverseer: true,
          mergedIntoId: 'somebody',
        },
      ]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ visitingSpeakerId: 'speaker-new' }),
      );
    });

    it('сменили районного в визите — слот и запись получают другую карточку', async () => {
      // Слот ещё несёт связь с прежним братом; имя в нём уже новое.
      const s = slot({ visitingSpeakerId: 'previous-co' });
      assignmentRepo.findOne.mockResolvedValue(s);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(s.visitingSpeakerId).toBe('speaker-new');
      expect(assignmentRepo.save).toHaveBeenCalledWith(s);
    });

    it('под районным остался наш брат — запись всё равно о районном', async () => {
      // Визит ставит имя районного в слот и не снимает брата, назначенного
      // раньше. Журнал читал такой слот как «выступает наш брат».
      assignmentRepo.findOne.mockResolvedValue(
        slot({ publisherId: 'our-brother' }),
      );
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          speakerName: 'Иван Тестов',
          visitingSpeakerId: 'speaker-new',
        }),
      );
      const saved = repo.save.mock.calls.map((c: any[]) => c[0]);
      expect(saved.every((e: any) => !e.publisherId)).toBe(true);
    });

    it('запись брата, сделанную до визита, переписывает на районного', async () => {
      assignmentRepo.findOne.mockResolvedValue(
        slot({ publisherId: 'our-brother' }),
      );
      const brothers = {
        id: 'e-brother',
        publisherId: 'our-brother',
        visitingSpeakerId: null,
        speakerName: null,
      };
      repo.findOne.mockResolvedValue(brothers);
      repo.count.mockResolvedValue(1);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(brothers.publisherId).toBeNull();
      expect(brothers.speakerName).toBe('Иван Тестов');
    });

    it('обычного приезжего в неделю визита районным не считает', async () => {
      assignmentRepo.findOne.mockResolvedValue(
        slot({ speakerName: 'Пётр Гостев', speakerCongregation: null }),
      );
      await service.circuitVisitApplied(TENANT, WEEK);
      const saved = speakerRepo.save.mock.calls.map((c: any[]) => c[0]);
      expect(saved).toHaveLength(1);
      expect(saved[0].circuitOverseer).toBeUndefined();
    });

    it('возвращает убранную запись вместе с тем, что к ней добавили', async () => {
      repo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'gone',
          speakerName: 'Иван Тестов',
          publisherId: null,
          note: 'обед у семьи',
          deletedAt: new Date('2026-10-01T10:00:00Z'),
        },
      ]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.restore).toHaveBeenCalledWith('gone');
    });

    const gone = {
      id: 'gone',
      speakerName: 'Иван Тестов',
      publisherId: null,
      note: 'обед у семьи',
      deletedAt: new Date('2026-10-01T10:00:00Z'),
    };
    /** The first read is of the live entries, the second includes removed. */
    const weekHolds = (live: object[]) =>
      repo.find
        .mockResolvedValueOnce(live)
        .mockResolvedValueOnce([...live, gone]);

    it('ничего не возвращает, когда в неделе уже есть запись другого гостя', async () => {
      weekHolds([
        { id: 'guest', speakerName: 'Пётр Гостев', publisherId: null },
      ]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.restore).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('запись брата, стоявшего под визитом, уступает вернувшейся записи районного', async () => {
      weekHolds([{ id: 'brother', speakerName: null, publisherId: 'our' }]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.softDelete).toHaveBeenCalledWith('brother');
      expect(repo.restore).toHaveBeenCalledWith('gone');
    });

    it('запись брата с заметкой координатора не трогается', async () => {
      weekHolds([
        { id: 'brother', speakerName: null, publisherId: 'our', note: 'важно' },
      ]);
      await service.circuitVisitApplied(TENANT, WEEK);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    });

    /**
     * На живых данных 6 октября: заместитель, который уже был, в журнале
     * есть, а районного, который приедет в феврале, нет — у февраля ещё нет
     * программы выходных, и зеркалу нечего читать.
     */
    describe('у недели ещё нет программы выходных', () => {
      beforeEach(() => {
        assignmentRepo.findOne.mockResolvedValue(null);
      });

      it('запись пишется по самому визиту', async () => {
        await service.circuitVisitApplied(TENANT, WEEK);
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            direction: 'incoming',
            date: '2026-10-18',
            speakerName: 'Иван Тестов',
            visitingSpeakerId: 'speaker-new',
          }),
        );
        expect(speakerRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ circuitOverseer: true }),
        );
      });

      it('уже записанный визит второй раз не пишется', async () => {
        speakerRepo.find.mockResolvedValue([
          {
            id: 'co-card',
            firstName: 'Иван',
            lastName: 'Тестов',
            externalCongregationId: null,
            circuitOverseer: true,
          },
        ]);
        repo.find.mockResolvedValue([
          {
            id: 'e-1',
            speakerName: 'Иван Тестов',
            publisherId: null,
            visitingSpeakerId: 'co-card',
          },
        ]);
        await service.circuitVisitApplied(TENANT, WEEK);
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('сменили районного — та же запись получает новое имя и карточку', async () => {
        eventRepo.find.mockResolvedValue([
          visit({ coFirstName: 'Пётр', coLastName: 'Новый' }),
        ]);
        const entry = {
          id: 'e-1',
          speakerName: 'Иван Тестов',
          publisherId: null,
          visitingSpeakerId: 'previous-co',
          note: 'обед у семьи',
        };
        repo.find.mockResolvedValue([entry]);
        await service.circuitVisitApplied(TENANT, WEEK, 'Иван Тестов');
        expect(entry.speakerName).toBe('Пётр Новый');
        expect(entry.visitingSpeakerId).toBe('speaker-new');
        expect(entry.note).toBe('обед у семьи');
        expect(repo.save).toHaveBeenCalledTimes(1);
      });

      it('на эти выходные уже записан другой гость — его запись не трогается', async () => {
        repo.find.mockResolvedValue([
          { id: 'guest', speakerName: 'Пётр Гостев', publisherId: null },
        ]);
        await service.circuitVisitApplied(TENANT, WEEK);
        expect(repo.save).not.toHaveBeenCalled();
      });
    });

    describe('визит убран', () => {
      it('запись уходит — даже с заметкой и гостеприимством', async () => {
        repo.find.mockResolvedValue([
          {
            id: 'e-1',
            speakerName: ' иван  тестов ',
            publisherId: null,
            note: 'обед у семьи',
            hospitalityPublisherId: 'p-1',
            visitingSpeakerId: 'co-card',
          },
        ]);
        await service.circuitVisitRemoved(TENANT, WEEK, 'Иван Тестов');
        expect(repo.softDelete).toHaveBeenCalledWith('e-1');
      });

      it('запись другого докладчика той же недели остаётся', async () => {
        repo.find.mockResolvedValue([
          { id: 'e-2', speakerName: 'Пётр Гостев', publisherId: null },
          { id: 'e-3', speakerName: null, publisherId: 'our-brother' },
        ]);
        await service.circuitVisitRemoved(TENANT, WEEK, 'Иван Тестов');
        expect(repo.softDelete).not.toHaveBeenCalled();
      });

      it('без имени районного записей не трогает', async () => {
        await service.circuitVisitRemoved(TENANT, WEEK, null);
        expect(repo.find).not.toHaveBeenCalled();
        expect(repo.softDelete).not.toHaveBeenCalled();
      });

      it('брат, стоявший под районным, снова докладчик недели — и в журнале тоже', async () => {
        // Неделя уже отдана: имя районного снято, брат остался.
        assignmentRepo.findOne.mockResolvedValue(
          slot({ speakerName: null, publisherId: 'our-brother' }),
        );
        repo.find.mockResolvedValue([
          { id: 'e-1', speakerName: 'Иван Тестов', publisherId: null },
        ]);
        await service.circuitVisitRemoved(TENANT, WEEK, 'Иван Тестов');
        expect(repo.softDelete).toHaveBeenCalledWith('e-1');
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            direction: 'incoming',
            publisherId: 'our-brother',
          }),
        );
      });

      it('слот недели перестаёт указывать на его карточку', async () => {
        // Визит вернул слоту прежнее имя — пустое; связь с карточкой ставило
        // зеркало, и без этого пустой слот считался бы занятым.
        const s = slot({ speakerName: null, visitingSpeakerId: 'co-card' });
        assignmentRepo.findOne.mockResolvedValue(s);
        await service.circuitVisitRemoved(TENANT, WEEK, 'Иван Тестов');
        expect(s.visitingSpeakerId).toBeNull();
        expect(assignmentRepo.save).toHaveBeenCalledWith(s);
      });

      it('слот, в который уже вписан другой докладчик, не трогается', async () => {
        const s = slot({
          speakerName: 'Пётр Гостев',
          visitingSpeakerId: 'guest-card',
        });
        assignmentRepo.findOne.mockResolvedValue(s);
        await service.circuitVisitRemoved(TENANT, WEEK, 'Иван Тестов');
        expect(s.visitingSpeakerId).toBe('guest-card');
        expect(assignmentRepo.save).not.toHaveBeenCalled();
      });
    });

    describe('визит перенесён', () => {
      beforeEach(() => {
        // Прежняя неделя уже отдана: имя из слота снято, связь осталась.
        assignmentRepo.findOne.mockResolvedValue(
          slot({ speakerName: null, visitingSpeakerId: 'co-card' }),
        );
      });

      it('слот прежней недели перестаёт указывать на его карточку', async () => {
        repo.find.mockResolvedValue([]);
        await service.circuitVisitMoved(
          TENANT,
          WEEK,
          '2026-10-19',
          'Иван Тестов',
        );
        expect(assignmentRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ visitingSpeakerId: null }),
        );
      });

      const entry = () => ({
        id: 'e-1',
        speakerName: 'Иван Тестов',
        publisherId: null,
        note: 'обед у семьи',
        date: '2026-10-18',
      });

      it('запись переезжает на выходные новой недели и сохраняет заметку', async () => {
        const e = entry();
        repo.find.mockResolvedValue([e]);
        await service.circuitVisitMoved(
          TENANT,
          WEEK,
          '2026-10-19',
          'Иван Тестов',
        );
        expect(e.date).toBe('2026-10-25');
        expect(e.note).toBe('обед у семьи');
        expect(repo.save).toHaveBeenCalledWith(e);
        expect(repo.softDelete).not.toHaveBeenCalled();
      });

      it('в новой неделе уже есть запись — прежняя просто уходит', async () => {
        repo.find.mockResolvedValue([entry()]);
        repo.count.mockResolvedValue(1);
        await service.circuitVisitMoved(
          TENANT,
          WEEK,
          '2026-10-19',
          'Иван Тестов',
        );
        expect(repo.softDelete).toHaveBeenCalledWith('e-1');
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('нечего переносить — ничего не делает', async () => {
        repo.find.mockResolvedValue([]);
        await service.circuitVisitMoved(
          TENANT,
          WEEK,
          '2026-10-19',
          'Иван Тестов',
        );
        expect(repo.save).not.toHaveBeenCalled();
        expect(repo.softDelete).not.toHaveBeenCalled();
      });
    });
  });
});
