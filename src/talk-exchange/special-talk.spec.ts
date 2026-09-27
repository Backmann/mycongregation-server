// The notifications chain reaches the push SDK, which ships as ESM only.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { TalkExchangeService } from './talk-exchange.service';
import { SpecialTalkNotificationsService } from './special-talk-notifications.service';
import { specialTalkMessage } from '../special-events/event-messages';
import { UserRole } from '../common/enums/user-role.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import type { TalkExchange } from '../entities/talk-exchange.entity';
import type { Assignment } from '../entities/assignment.entity';

/**
 * Специальная речь — речь журнала «К нам / От нас» (27 сентября).
 *
 * Тема записывается в журнале; программа получает её вместо названия речи с
 * отметкой «Специальная речь». Новая неделя подхватывает из журнала всё, что
 * там уже договорено, — но только в пустой слот.
 */
const T = 'cong-1';
const ADMIN = {
  id: 'u1',
  email: 'a@b.c',
  role: UserRole.ADMIN,
  congregationId: T,
  uiLanguage: 'ru',
};

function emptySlot(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'slot-1',
    congregationId: T,
    weekStartDate: '2027-03-08',
    partKey: 'public_talk_speaker',
    partTitle: null,
    publisherId: null,
    speakerName: null,
    speakerCongregation: null,
    visitingSpeakerId: null,
    publicTalkId: null,
    specialTalk: false,
    status: AssignmentStatus.DRAFT,
    ...over,
  } as Assignment;
}

function build(opts: {
  slot?: Assignment | null;
  entry?: TalkExchange | null;
}) {
  const state = {
    slot: opts.slot ?? null,
    entry: opts.entry ?? null,
    saved: [] as TalkExchange[],
    deleted: [] as string[],
  };
  const announce = jest.fn(async () => {});
  const service = Object.create(
    TalkExchangeService.prototype,
  ) as TalkExchangeService;
  Object.assign(service, {
    repo: {
      create: (x: Partial<TalkExchange>) => ({ ...x }),
      save: jest.fn(async (x: TalkExchange) => {
        const row = { ...x, id: x.id ?? 'tx-new' } as TalkExchange;
        state.saved.push(row);
        state.entry = row;
        return row;
      }),
      findOne: jest.fn(async () => state.entry),
      softDelete: jest.fn(async (id: string) => {
        state.deleted.push(id);
      }),
    },
    assignmentRepo: {
      findOne: jest.fn(async () => state.slot),
      save: jest.fn(async (x: Assignment) => {
        state.slot = x;
        return x;
      }),
    },
    speakerRepo: {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => [
        { id: 'vs-1', firstName: 'Иван', lastName: 'Гость' },
      ]),
      create: (x: unknown) => x,
      save: jest.fn(async (x: object) => ({ id: 'vs-new', ...x })),
    },
    congregationRepo: { find: jest.fn(async () => []) },
    publicTalkRepo: {
      findOne: jest.fn(async () => ({ number: 12, title: 'Каталожная' })),
    },
    responsibilitiesRepo: { count: jest.fn(async () => 1) },
    meetingSettingsRepo: {
      find: jest.fn(async () => [
        { effectiveFrom: '2020-01-06', weekendDow: 7 },
      ]),
    },
    auditLog: {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logEvent: jest.fn(),
    },
    specialTalkNotifications: { announceIfNew: announce },
  });
  return { service, state, announce };
}

describe('Специальная речь в журнале', () => {
  it('тема вместо номера: в программе — тема и отметка, номера нет', async () => {
    const { service, state, announce } = build({ slot: emptySlot() });
    await service.create(
      T,
      {
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        publisherId: 'pub-1',
        publicTalkId: '00000000-0000-0000-0000-000000000012',
        specialTheme: '  Возможен ли мир?  ',
      },
      ADMIN,
    );
    expect(state.saved[0].specialTheme).toBe('Возможен ли мир?');
    expect(state.saved[0].publicTalkId).toBeNull();
    expect(state.slot).toMatchObject({
      publisherId: 'pub-1',
      partTitle: 'Возможен ли мир?',
      specialTalk: true,
      publicTalkId: null,
    });
    expect(announce).toHaveBeenCalledWith(state.saved[0], null);
  });

  it('номер из каталога без слова о теме снимает тему', async () => {
    const entry = {
      id: 'tx-1',
      congregationId: T,
      direction: TalkExchangeDirection.INCOMING,
      date: '2027-03-14',
      status: TalkExchangeStatus.CONFIRMED,
      publisherId: 'pub-1',
      publicTalkId: null,
      specialTheme: 'Возможен ли мир?',
    } as TalkExchange;
    const { service, state, announce } = build({
      slot: emptySlot({
        publisherId: 'pub-1',
        partTitle: 'Возможен ли мир?',
        specialTalk: true,
      }),
      entry,
    });
    await service.update(
      T,
      'tx-1',
      { publicTalkId: '00000000-0000-0000-0000-000000000012' },
      ADMIN,
    );
    expect(state.entry!.specialTheme).toBeNull();
    // Программа занята — но это та же неделя того же брата: приложение
    // спросит, заменить ли; с согласием слот получает номер и теряет отметку.
    await service.update(
      T,
      'tx-1',
      {
        publicTalkId: '00000000-0000-0000-0000-000000000012',
        overwriteProgram: true,
      },
      ADMIN,
    );
    expect(state.slot).toMatchObject({
      specialTalk: false,
      partTitle: '№12. Каталожная',
    });
    expect(announce).toHaveBeenLastCalledWith(
      expect.objectContaining({ specialTheme: null }),
      expect.anything(),
    );
  });

  it('новая неделя подхватывает журнал — в пустой слот', async () => {
    const { service, state } = build({
      slot: emptySlot(),
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: null,
        speakerName: null,
        publicTalkId: null,
        specialTheme: 'Возможен ли мир?',
      } as TalkExchange,
    });
    await service.fillEmptySlot(T, '2027-03-08');
    // Докладчика ещё нет — в программе тема без имени.
    expect(state.slot).toMatchObject({
      partTitle: 'Возможен ли мир?',
      specialTalk: true,
      publisherId: null,
      speakerName: null,
    });
  });

  it('подхватывает и докладчика без речи — любую договорённость', async () => {
    const { service, state } = build({
      slot: emptySlot(),
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: 'pub-7',
        publicTalkId: null,
        specialTheme: null,
      } as TalkExchange,
    });
    await service.fillEmptySlot(T, '2027-03-08');
    expect(state.slot).toMatchObject({ publisherId: 'pub-7', partTitle: null });
  });

  it('занятый слот не трогает никогда', async () => {
    const taken = emptySlot({ speakerName: 'Другой Брат' });
    const { service, state } = build({
      slot: taken,
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: 'pub-7',
        specialTheme: 'Тема',
      } as TalkExchange,
    });
    await service.fillEmptySlot(T, '2027-03-08');
    expect(state.slot).toBe(taken);
    expect(state.slot).toMatchObject({
      speakerName: 'Другой Брат',
      specialTalk: false,
      partTitle: null,
    });
  });

  it('зеркало несёт тему из программы в журнал', async () => {
    const { service, state } = build({
      slot: emptySlot({
        publisherId: 'pub-1',
        partTitle: 'Как Библия может вам помочь?',
        specialTalk: true,
      }),
      entry: null,
    });
    await service.syncProgramToJournal(T, '2026-09-21');
    expect(state.saved[0]).toMatchObject({
      publisherId: 'pub-1',
      specialTheme: 'Как Библия может вам помочь?',
      publicTalkId: null,
    });
  });

  it('речь из каталога в программе снимает тему и в журнале', async () => {
    const { service, state } = build({
      slot: emptySlot({ publisherId: 'pub-1', publicTalkId: 'talk-12' }),
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-09-27',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: 'pub-1',
        visitingSpeakerId: null,
        speakerName: null,
        publicTalkId: null,
        specialTheme: 'Старая тема',
      } as TalkExchange,
    });
    await service.syncProgramToJournal(T, '2026-09-21');
    expect(state.entry).toMatchObject({
      publicTalkId: 'talk-12',
      specialTheme: null,
    });
  });

  it('запись с темой не пропадает, пока программа пуста', async () => {
    const { service, state } = build({
      slot: emptySlot(),
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        status: TalkExchangeStatus.CONFIRMED,
        specialTheme: 'Тема',
      } as TalkExchange,
    });
    await service.syncProgramToJournal(T, '2027-03-08');
    expect(state.deleted).toEqual([]);
  });
});

describe('Объявление о специальной речи', () => {
  const entry = (over: Partial<TalkExchange> = {}) =>
    ({
      id: 'tx-1',
      congregationId: T,
      direction: TalkExchangeDirection.INCOMING,
      status: TalkExchangeStatus.CONFIRMED,
      date: '2027-03-14',
      specialTheme: 'Возможен ли мир?',
      ...over,
    }) as TalkExchange;

  function svc() {
    const notify = jest.fn(async () => {});
    const service = new SpecialTalkNotificationsService(
      {
        find: jest.fn(async () => [
          { id: 'u1', uiLanguage: 'ru' },
          { id: 'u2', uiLanguage: 'de' },
        ]),
      } as never,
      { todayFor: jest.fn(async () => '2026-09-27') } as never,
      { notify } as never,
    );
    return { service, notify };
  }

  it('всем, на их языке, один раз', async () => {
    const { service, notify } = svc();
    await service.announceIfNew(entry(), null);
    expect(notify).toHaveBeenCalledTimes(2);
    const calls = notify.mock.calls as unknown as [
      { userIds: string[]; title: string; key: string; data: object },
    ][];
    const ru = calls.find((c) => c[0].userIds[0] === 'u1')![0];
    expect(ru.title).toBe('Специальная речь');
    expect(ru.data).toEqual({
      type: 'special_talk',
      weekStartDate: '2027-03-08',
    });
    expect(ru.key.length).toBeLessThanOrEqual(96);
    expect(calls[1][0].key).toBe(ru.key);
  });

  it('молчит о прошедшем, о записи без темы и о правке не темы', async () => {
    const { service, notify } = svc();
    await service.announceIfNew(entry({ date: '2026-09-20' }), null);
    await service.announceIfNew(entry({ specialTheme: null }), null);
    await service.announceIfNew(entry(), {
      specialTheme: 'Возможен ли мир?',
      date: '2027-03-14',
    });
    await service.announceIfNew(
      entry({ status: TalkExchangeStatus.DID_NOT_HAPPEN }),
      null,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('перенос на другой день — новость, и ключ другой', () => {
    const a = SpecialTalkNotificationsService.keyOf({
      id: 'tx-1',
      specialTheme: 'Т',
      date: '2027-03-14',
    });
    const b = SpecialTalkNotificationsService.keyOf({
      id: 'tx-1',
      specialTheme: 'Т',
      date: '2027-03-21',
    });
    expect(a).not.toBe(b);
  });

  it('текст', () => {
    expect(specialTalkMessage('Возможен ли мир?', '2027-03-14', 'ru')).toEqual({
      title: 'Специальная речь',
      body: '«Возможен ли мир?» — воскресенье, 14 марта, на встрече в выходные.',
    });
  });
});

describe('Докладчик приходит к уже записанной теме', () => {
  it('без вопроса «заменить ли программу»', async () => {
    const { service, state } = build({
      slot: emptySlot({ partTitle: 'Тема', specialTalk: true }),
      entry: {
        id: 'tx-1',
        congregationId: T,
        direction: TalkExchangeDirection.INCOMING,
        date: '2027-03-14',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: null,
        specialTheme: 'Тема',
      } as TalkExchange,
    });
    const res = await service.update(
      T,
      'tx-1',
      { publisherId: 'pub-3' },
      ADMIN,
    );
    expect(res.programConflict).toBeUndefined();
    expect(state.slot).toMatchObject({
      publisherId: 'pub-3',
      partTitle: 'Тема',
      specialTalk: true,
    });
  });
});

describe('Обмен неделями', () => {
  it('тема уходит вместе с речью, гостю с другой речью не остаётся', async () => {
    const { service, state } = build({
      slot: emptySlot({ speakerName: 'Шмидт Андреас', partTitle: 'Другая' }),
      entry: {
        id: 'tx-1',
        direction: TalkExchangeDirection.INCOMING,
        date: '2026-09-27',
        status: TalkExchangeStatus.CONFIRMED,
        publisherId: 'pub-1',
        specialTheme: 'Как Библия может вам помочь?',
      } as TalkExchange,
    });
    await service.syncProgramToJournal(T, '2026-09-21');
    expect(state.entry).toMatchObject({
      speakerName: 'Шмидт Андреас',
      specialTheme: null,
    });
  });
});
