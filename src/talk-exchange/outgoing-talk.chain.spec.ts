jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import {
  OutgoingFacts,
  OutgoingTalkNotificationsService,
} from './outgoing-talk-notifications.service';
import { memRepo } from '../common/testing/mem-repo';
import { clockStub } from '../common/testing/clock-stub';
import { realGateway } from '../common/testing/real-gateway';

/**
 * A TALK IN ANOTHER CONGREGATION, from the journal to the brother's device.
 *
 * Until 3 October 2026 a brother sent to speak elsewhere was told nothing:
 * the journal «От нас» was written, an absence appeared on his card, and that
 * was all. The real notices service and the real gateway run here over tables
 * in memory; only the transport is a recorder.
 */

const C = 'cong-1';
const NOW = new Date('2026-10-03T09:00:00Z'); // Saturday, 11:00 in Berlin

function world(over: { noDevice?: string[] } = {}) {
  const publishers = memRepo<any>([
    { id: 'p-a', congregationId: C, userId: 'u-a', firstName: 'Андрей' },
    { id: 'p-b', congregationId: C, userId: 'u-b', firstName: 'Bernd' },
    { id: 'p-x', congregationId: C, userId: null, firstName: 'Х' },
  ]);
  const users = memRepo<any>([
    { id: 'u-a', uiLanguage: 'ru', isActive: true, email: 'a@example.invalid' },
    { id: 'u-b', uiLanguage: 'de', isActive: true, email: 'b@example.invalid' },
  ]);
  const gateway = realGateway({ users, publishers, noDevice: over.noDevice });
  const service = new OutgoingTalkNotificationsService(
    publishers as any,
    memRepo<any>([
      {
        id: 'h1',
        congregationId: C,
        name: 'Dortmund-Russisch',
        meetingTime: '10:00',
      },
      { id: 'h2', congregationId: C, name: 'Hamm-Mitte', meetingTime: null },
    ]) as any,
    memRepo<any>([
      { id: 't15', number: 15, title: 'Делайте добро всем' },
      { id: 't20', number: 20, title: 'Настало ли время' },
    ]) as any,
    clockStub('Europe/Berlin'),
    gateway.notifications,
  );
  return { service, ...gateway };
}

const facts = (over: Partial<OutgoingFacts> = {}): OutgoingFacts => ({
  direction: 'outgoing',
  status: 'confirmed',
  date: '2026-10-18',
  publisherId: 'p-a',
  hostCongregationId: 'h1',
  publicTalkId: 't15',
  specialTheme: null,
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('a talk arranged for one of ours', () => {
  it('is said to him at once: the day, the hour, where and which talk', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts(), null);

    expect(w.pushes).toEqual([
      {
        userId: 'u-a',
        title: 'Вам назначена речь в другом собрании',
        body: 'Вс 18 октября, 10:00 · Dortmund-Russisch · №15 «Делайте добро всем»',
        data: expect.objectContaining({ type: 'outgoing_talk' }),
      },
    ]);
  });

  it('in the language HE reads the app in', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ publisherId: 'p-b' }), null);

    expect(w.to('u-b')[0].title).toBe(
      'Du hast einen Vortrag in einer anderen Versammlung',
    );
    expect(w.to('u-b')[0].body).toBe(
      'So 18. Oktober, 10:00 · Dortmund-Russisch · №15 «Делайте добро всем»',
    );
  });

  it('a tentative arrangement says that it is tentative', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ status: 'tentative' }), null);

    expect(w.to('u-a')[0].body).toMatch(/ · предварительно$/);
  });

  it('with no host or talk chosen yet it still says what it is', async () => {
    const w = world();

    await w.service.announce(
      C,
      'tx1',
      facts({ hostCongregationId: null, publicTalkId: null }),
      null,
    );

    expect(w.to('u-a')[0].body).toBe('Вс 18 октября · другое собрание');
  });

  // His own assignment: with no device to take it, it goes by post.
  it('goes by post to somebody with no device', async () => {
    const w = world({ noDevice: ['u-a'] });

    await w.service.announce(C, 'tx1', facts(), null);

    expect(w.pushes).toEqual([]);
    expect(w.letters).toEqual([
      {
        to: 'a@example.invalid',
        title: 'Вам назначена речь в другом собрании',
        body: expect.stringContaining('Dortmund-Russisch'),
      },
    ]);
  });

  it('says nothing about an incoming speaker — that is not ours to tell', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ direction: 'incoming' }), null);

    expect(w.pushes).toEqual([]);
  });

  it('says nothing about a day that has passed', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ date: '2026-09-27' }), null);

    expect(w.pushes).toEqual([]);
  });

  it('a brother with no login is passed over without an error', async () => {
    const w = world();

    await expect(
      w.service.announce(C, 'tx1', facts({ publisherId: 'p-x' }), null),
    ).resolves.toBeUndefined();
    expect(w.pushes).toEqual([]);
  });
});

describe('an arrangement that changes', () => {
  it('another day is said as a change', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ date: '2026-10-25' }), facts());

    expect(w.to('u-a')).toHaveLength(1);
    expect(w.to('u-a')[0].title).toBe('Изменилась ваша речь в другом собрании');
    expect(w.to('u-a')[0].body).toContain('Вс 25 октября');
  });

  it('another talk or another host is a change too', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ publicTalkId: 't20' }), facts());
    await w.service.announce(
      C,
      'tx2',
      facts({ hostCongregationId: 'h2' }),
      facts(),
    );

    expect(w.to('u-a').map((p) => p.body)).toEqual([
      'Вс 18 октября, 10:00 · Dortmund-Russisch · №20 «Настало ли время»',
      'Вс 18 октября · Hamm-Mitte · №15 «Делайте добро всем»',
    ]);
  });

  it('tentative becoming firm is worth a word', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts(), facts({ status: 'tentative' }));

    expect(w.to('u-a')[0].body).not.toContain('предварительно');
  });

  // A note or the hospitality is the coordinator's business, not his.
  it('a save that changes nothing he needs to know says nothing', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts(), facts());

    expect(w.pushes).toEqual([]);
  });

  it('another brother in his place: one is assigned, the other told not to prepare', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts({ publisherId: 'p-b' }), facts());

    expect(w.to('u-b')[0].title).toBe(
      'Du hast einen Vortrag in einer anderen Versammlung',
    );
    expect(w.to('u-a')).toEqual([
      expect.objectContaining({
        title: 'Речь в другом собрании отменена',
        body: 'Вс 18 октября · Dortmund-Russisch — готовиться не нужно',
      }),
    ]);
  });

  it('the entry removed: he is told not to prepare', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', null, facts());

    expect(w.to('u-a')[0].title).toBe('Речь в другом собрании отменена');
  });

  it('marked «не состоялось» before the day: the same', async () => {
    const w = world();

    await w.service.announce(
      C,
      'tx1',
      facts({ status: 'did_not_happen' }),
      facts(),
    );

    expect(w.to('u-a')[0].title).toBe('Речь в другом собрании отменена');
  });

  // The schedule's own lesson: a key built from the facts swallowed «to him,
  // to another, back to him».
  it('to him, to another, back to him — the third word arrives', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts(), null);
    jest.setSystemTime(new Date(NOW.getTime() + 60_000));
    await w.service.announce(C, 'tx1', facts({ publisherId: 'p-b' }), facts());
    jest.setSystemTime(new Date(NOW.getTime() + 120_000));
    await w.service.announce(C, 'tx1', facts(), facts({ publisherId: 'p-b' }));

    expect(w.to('u-a').map((p) => p.title)).toEqual([
      'Вам назначена речь в другом собрании',
      'Речь в другом собрании отменена',
      'Вам назначена речь в другом собрании',
    ]);
  });

  it('a double tap is one message', async () => {
    const w = world();

    await w.service.announce(C, 'tx1', facts(), null);
    await w.service.announce(C, 'tx1', facts(), null);

    expect(w.to('u-a')).toHaveLength(1);
  });
});
