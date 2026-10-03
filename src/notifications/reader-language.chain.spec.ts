jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { memRepo } from '../common/testing/mem-repo';
import { clockStub } from '../common/testing/clock-stub';
import { realGateway } from '../common/testing/real-gateway';
import { CartWeeksService } from '../cart-weeks/cart-weeks.service';
import { ReportRemindersService } from '../report-reminders/report-reminders.service';
import { TaskRemindersService } from '../tasks/task-reminders.service';
import { CleaningRemindersService } from '../cleaning/cleaning-reminders.service';
import { reportingPublisherWhere } from '../common/reporting-publishers';

/**
 * EVERY READER IN THE LANGUAGE HE CHOSE.
 *
 * Half the senders spoke the CONGREGATION's language to everybody, and the
 * cart's wrote plain Russian (found 3 October 2026): a brother who reads the
 * app in German got «Вы ещё не подали отчёт». The words are now made in the
 * gateway, per person. So the real senders and the real gateway run here
 * together, in a congregation whose language is Russian, with three readers
 * of three languages — and what is checked is what arrives.
 */

const C = 'cong-1';

function people() {
  const publishers = memRepo<any>(
    ['ru', 'en', 'de'].map((l) => ({
      id: `p-${l}`,
      congregationId: C,
      userId: `u-${l}`,
      firstName: l,
      lastName: 'Имя',
      displayName: `Имя ${l}`,
      serviceGroupId: 'g1',
      capabilities: { public_witnessing: true },
      // What reportingPublisherWhere asks for is whatever it asks for; the
      // row carries each of its keys with the wanted value below.
    })),
  );
  const users = memRepo<any>(
    ['ru', 'en', 'de'].map((l) => ({
      id: `u-${l}`,
      congregationId: C,
      uiLanguage: l,
      isActive: true,
      email: `${l}@example.invalid`,
    })),
  );
  const gateway = realGateway({ users, publishers });
  const titles = () =>
    Object.fromEntries(
      ['ru', 'en', 'de'].map((l) => [l, gateway.to(`u-${l}`)[0]?.title]),
    );
  const bodies = () =>
    Object.fromEntries(
      ['ru', 'en', 'de'].map((l) => [l, gateway.to(`u-${l}`)[0]?.body]),
    );
  return { publishers, users, ...gateway, titles, bodies };
}

const at = (iso: string) => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(iso));
};
afterEach(() => jest.useRealTimers());

describe('the gateway writes for each reader', () => {
  beforeEach(() => at('2026-10-03T09:00:00Z'));

  it('one call, three people, three languages', async () => {
    const w = people();

    await w.notifications.notify({
      tenantId: C,
      userIds: ['u-ru', 'u-en', 'u-de'],
      text: (l) => ({ title: `title-${l}`, body: `body-${l}` }),
      kind: 'cart_published',
      data: { type: 'cart_published' },
    });

    expect(w.titles()).toEqual({
      ru: 'title-ru',
      en: 'title-en',
      de: 'title-de',
    });
    expect(w.bodies()).toEqual({ ru: 'body-ru', en: 'body-en', de: 'body-de' });
    // The ledger holds what each was told, in the words he was told it.
    expect(w.outbox.rows.map((r) => r.title).sort()).toEqual([
      'title-de',
      'title-en',
      'title-ru',
    ]);
  });

  it('words given ready-made go to everybody as they are', async () => {
    const w = people();

    await w.notifications.notify({
      tenantId: C,
      userIds: ['u-ru', 'u-de'],
      title: 'Как есть',
      body: 'Без перевода',
      kind: 'schedule',
      data: { type: 'schedule_changed' },
    });

    expect(w.pushes.map((p) => p.title)).toEqual(['Как есть', 'Как есть']);
  });

  it('a call with no words at all sends nothing rather than an empty message', async () => {
    const w = people();

    await w.notifications.notify({
      tenantId: C,
      userIds: ['u-ru'],
      kind: 'schedule',
      data: { type: 'schedule_changed' },
    });

    expect(w.pushes).toEqual([]);
    expect(w.outbox.rows).toEqual([]);
  });

  // «Задача на завтра» led nowhere from its first day: the app's table of
  // destinations and the server's types were never compared.
  it('a type the app has no destination for fails the test that sends it', async () => {
    const w = people();

    await expect(
      w.notifications.notify({
        tenantId: C,
        userIds: ['u-ru'],
        title: 'x',
        body: 'y',
        kind: 'task',
        data: { type: 'task_someday' },
      }),
    ).rejects.toThrow('NOTIFICATION_TYPES');
  });

  it('knows who switched a category off', async () => {
    const publishers = memRepo<any>([]);
    const users = memRepo<any>([]);
    const { notifications } = realGateway({
      users,
      publishers,
      preferences: [
        { userId: 'u-ru', category: 'cleaning', enabled: false },
        { userId: 'u-en', category: 'cleaning', enabled: true },
        { userId: 'u-de', category: 'reports', enabled: false },
      ],
    });

    const off = await notifications.switchedOff(
      ['u-ru', 'u-en', 'u-de'],
      'cleaning',
    );

    expect([...off]).toEqual(['u-ru']);
  });
});

describe('the carts', () => {
  beforeEach(() => at('2026-10-03T09:00:00Z'));

  function carts() {
    const w = people();
    const slot = {
      id: 's1',
      congregationId: C,
      weekId: 'w1',
      date: '2026-10-07',
      startTime: '10:00:00',
      week: { id: 'w1', status: 'published' },
      location: { name: 'Marktplatz' },
    };
    const assignments = memRepo<any>([
      { id: 'a1', congregationId: C, slotId: 's1', publisherId: 'p-ru' },
      { id: 'a2', congregationId: C, slotId: 's1', publisherId: 'p-en' },
      { id: 'a3', congregationId: C, slotId: 's1', publisherId: 'p-de' },
    ]);
    const service = new CartWeeksService(
      memRepo<any>([
        { id: 'w1', congregationId: C, status: 'collecting' },
      ]) as any,
      memRepo<any>([slot]) as any,
      memRepo<any>([]) as any, // requests
      {
        ...assignments,
        count: async (q: any) => (await assignments.find(q)).length,
        remove: async (row: any) => {
          assignments.rows.splice(assignments.rows.indexOf(row), 1);
        },
      } as any,
      memRepo<any>([]) as any, // locations
      w.publishers as any,
      // The three who manage the carts — one of each language.
      memRepo<any>(
        ['ru', 'en', 'de'].map((l) => ({
          congregationId: C,
          type: 'public_witnessing',
          userId: `u-${l}`,
        })),
      ) as any,
      {} as any,
      w.notifications,
      clockStub('Europe/Berlin'),
    );
    return { ...w, service, assignments };
  }

  it('a published week is said to everyone on it, each in his language', async () => {
    const w = carts();

    await w.service.publishWeek(C, 'w1');

    expect(w.titles()).toEqual({
      ru: 'Служение с тележками',
      en: 'Cart witnessing',
      de: 'Zeugnisgeben mit Wagen',
    });
    expect(w.bodies().de).toBe('Der Plan für die Woche ist veröffentlicht.');
    // It leads to the carts, not to wherever the app happens to be.
    expect(w.pushes[0].data.type).toBe('cart_published');
  });

  it('a cancellation reaches the managers with a day a person can read', async () => {
    const w = carts();

    await w.service.cancelMyAssignment(C, 's1', { id: 'u-ru' } as any);

    expect(w.bodies()).toEqual({
      ru: 'Имя ru: участие отменено — Marktplatz, Ср 7 октября, 10:00. Место снова свободно.',
      en: 'Имя ru cancelled — Marktplatz, Wed 7 October, 10:00. The place is free again.',
      de: 'Имя ru hat abgesagt — Marktplatz, Mi 7. Oktober, 10:00. Der Platz ist wieder frei.',
    });
    // Not «отменил»: the same sentence is said of a sister.
    expect(w.bodies().ru).not.toContain('отменил ');
  });

  it('a request for a free place reaches the managers the same way', async () => {
    const w = carts();
    // One place is free: the slot holds three, a fourth may ask.
    w.assignments.rows.pop();

    await w.service.applyToSlot(C, 's1', { id: 'u-de' } as any, {} as any);

    expect(w.titles()).toEqual({
      ru: 'Тележки: новая заявка',
      en: 'Cart: new request',
      de: 'Wagen: neue Anfrage',
    });
    expect(w.bodies().ru).toBe(
      'Заявка на свободное место — Marktplatz, Ср 7 октября, 10:00 (Имя de).',
    );
  });
});

describe('the report reminder', () => {
  it('reaches a German reader in German though the congregation is Russian', async () => {
    at('2026-10-05T16:30:00Z'); // the 5th, 18:30 in Berlin
    const w = people();
    // Make each card answer the «reporting publisher» filter, whatever it is.
    const wanted = reportingPublisherWhere(C) as Record<string, unknown>;
    for (const row of w.publishers.rows) {
      for (const [k, v] of Object.entries(wanted)) {
        if (typeof v !== 'object' || v === null) row[k] = v;
      }
    }
    const service = new ReportRemindersService(
      { find: async () => w.publishers.rows } as any,
      memRepo<any>([]) as any, // nobody reported
      memRepo<any>([]) as any,
      memRepo<any>([]) as any,
      memRepo<any>([
        { id: C, timezone: 'Europe/Berlin', language: 'ru' },
      ]) as any,
      w.users as any,
      {} as any,
      w.notifications,
    );

    await service.tick();

    expect(w.bodies()).toEqual({
      // Not «2026 г..»: the year's own «г.» ran into the full stop.
      ru: 'Вы ещё не подали отчёт за сентябрь 2026.',
      en: 'You have not handed in your report for September 2026.',
      de: 'Du hast den Bericht für September 2026 noch nicht abgegeben.',
    });
  });
});

describe('an elder task', () => {
  it('is announced to each addressee in his own language', async () => {
    at('2026-10-03T09:00:00Z');
    const w = people();
    const service = new TaskRemindersService(
      memRepo<any>([]) as any,
      memRepo<any>([
        { id: C, timezone: 'Europe/Berlin', language: 'ru' },
      ]) as any,
      memRepo<any>([]) as any,
      { membersOf: async () => w.publishers.rows } as any,
      w.notifications,
    );

    await service.announceAssignment({
      id: 't1',
      congregationId: C,
      area: 'announcements',
      dueDate: '2026-10-08',
      dueTime: '19:00',
    } as any);

    expect(w.titles()).toEqual({
      ru: 'Вам поручена задача',
      en: 'A task has been given to you',
      de: 'Dir wurde eine Aufgabe übertragen',
    });
    expect(w.bodies()).toEqual({
      ru: 'Объявления · Чт 8 октября · 19:00',
      en: 'Announcements · Thu 8 October · 19:00',
      de: 'Bekanntmachungen · Do 8. Oktober · 19:00',
    });
  });
});

describe('the cleaning reminder', () => {
  it('reaches the whole group, each in his language', async () => {
    // Monday 5 October, 09:00 in Berlin: the weekly group's reminder.
    at('2026-10-05T07:00:00Z');
    const w = people();
    const service = new CleaningRemindersService(
      memRepo<any>([
        { id: C, timezone: 'Europe/Berlin', language: 'ru' },
      ]) as any,
      memRepo<any>([]) as any, // meeting settings
      memRepo<any>([
        {
          id: 'cl1',
          congregationId: C,
          weekStartDate: '2026-10-05',
          slotType: 'thorough',
          serviceGroupId: 'g1',
          windows: [4, 5],
        },
      ]) as any,
      memRepo<any>([]) as any,
      w.publishers as any,
      memRepo<any>([], { unique: ['congregationId', 'kind', 'key'] }) as any,
      {} as any,
      w.notifications,
      { gatheringsForWeek: async () => [] } as any,
    );

    await service.runTick(new Date());

    expect(w.titles()).toEqual({
      ru: 'Еженедельная уборка',
      en: 'Weekly cleaning',
      de: 'Wöchentliche Reinigung',
    });
    expect(w.bodies().de).toContain('Fenster: 4, 5');
  });
});
