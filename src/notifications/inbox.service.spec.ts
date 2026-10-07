import { Repository } from 'typeorm';
import { InboxSeen } from '../entities/inbox-seen.entity';
import { NotificationOutbox } from '../entities/notification-outbox.entity';
import { INBOX_DAYS, INBOX_LIMIT, InboxService } from './inbox.service';

/**
 * «Мои уведомления». What the words of the query select is proved on the
 * stand against a real table; here: whose rows are asked for, what each row
 * becomes, and what «прочитано» writes.
 */
describe('InboxService', () => {
  const NOW = new Date('2026-10-07T16:00:00Z');

  const build = (rows: Partial<NotificationOutbox>[], seenAt: Date | null) => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => rows),
    };
    const seen = {
      findOne: jest.fn(async () => (seenAt ? { userId: 'u1', seenAt } : null)),
      upsert: jest.fn(async () => undefined),
    };
    const service = new InboxService(
      {
        createQueryBuilder: () => qb,
      } as unknown as Repository<NotificationOutbox>,
      seen as unknown as Repository<InboxSeen>,
    );
    return { service, qb, seen };
  };

  it('asks for this person, in this congregation, and for nobody else', async () => {
    const { service, qb } = build([], null);

    await service.read('c1', 'u1', NOW);

    expect(qb.where).toHaveBeenCalledWith(
      'n.congregation_id = :congregationId',
      {
        congregationId: 'c1',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('n.user_id = :userId', {
      userId: 'u1',
    });
  });

  it('leaves out test sends and what is still held for the morning, and reaches back so many days and no further', async () => {
    const { service, qb } = build([], null);

    await service.read('c1', 'u1', NOW);

    const asked = qb.andWhere.mock.calls.map((c) => c[0] as string);
    expect(asked).toContain('n.kind <> :test');
    expect(asked).toContain('(n.not_before IS NULL OR n.not_before <= :now)');
    const since = qb.andWhere.mock.calls.find(
      (c) => c[0] === 'n.created_at > :since',
    )?.[1] as { since: Date };
    expect(NOW.getTime() - since.since.getTime()).toBe(
      INBOX_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(qb.limit).toHaveBeenCalledWith(INBOX_LIMIT);
  });

  it('a message nobody received is in the list all the same — marked, not hidden', async () => {
    // The reason the list exists: a phone without Google services, an iPhone
    // that opens the site from Safari.
    const { service } = build(
      [
        {
          id: 'n1',
          title: 'Вам назначено',
          body: 'Чтение Библии',
          data: { type: 'assignment' },
          kind: 'part',
          status: 'no_device',
          sentAt: null,
          notBefore: null,
          createdAt: new Date('2026-10-06T10:00:00Z'),
        },
        {
          id: 'n2',
          title: 'Завтра — уборка',
          body: 'Группа 2',
          data: {},
          kind: 'cleaning',
          status: 'sent',
          sentAt: new Date('2026-10-05T16:00:00Z'),
          notBefore: null,
          createdAt: new Date('2026-10-05T16:00:00Z'),
        },
      ],
      null,
    );

    const inbox = await service.read('c1', 'u1', NOW);

    expect(inbox.items.map((i) => [i.id, i.delivered])).toEqual([
      ['n1', false],
      ['n2', true],
    ]);
    expect(inbox.items[0]).toMatchObject({
      title: 'Вам назначено',
      body: 'Чтение Библии',
      data: { type: 'assignment' },
      at: new Date('2026-10-06T10:00:00Z'),
    });
  });

  it('a message held overnight was said in the morning, not when it was written', async () => {
    const { service } = build(
      [
        {
          id: 'n1',
          title: 't',
          body: 'b',
          data: {},
          kind: 'task',
          status: 'no_device',
          sentAt: null,
          notBefore: new Date('2026-10-07T06:00:00Z'),
          createdAt: new Date('2026-10-06T21:30:00Z'),
        },
      ],
      null,
    );

    const inbox = await service.read('c1', 'u1', NOW);

    expect(inbox.items[0].at).toEqual(new Date('2026-10-07T06:00:00Z'));
  });

  it('says up to when the list was read — and «never» as null', async () => {
    const read = new Date('2026-10-06T08:00:00Z');
    expect(
      (await build([], read).service.read('c1', 'u1', NOW)).seenAt,
    ).toEqual(read);
    expect(
      (await build([], null).service.read('c1', 'u1', NOW)).seenAt,
    ).toBeNull();
  });

  it('opening the list writes one moment for the person, replacing the last', async () => {
    const { service, seen } = build([], null);

    await service.markSeen('u1', NOW);

    expect(seen.upsert).toHaveBeenCalledWith({ userId: 'u1', seenAt: NOW }, [
      'userId',
    ]);
  });
});
