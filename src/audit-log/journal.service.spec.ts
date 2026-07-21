import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { JournalService } from './journal.service';

const row = (over: Partial<AuditLog> = {}): AuditLog =>
  ({
    id: 'a1',
    congregationId: 'cong-1',
    entityType: 'assignment',
    entityId: 'as-1',
    action: 'UPDATE',
    actorUserId: 'user-1',
    subjectId: 'pub-1',
    source: 'user',
    beforeJson: null,
    afterJson: null,
    changedFields: ['publisherId'],
    redactedAt: null,
    createdAt: new Date('2026-07-21T10:00:00Z'),
    ...over,
  }) as AuditLog;

describe('JournalService', () => {
  let service: JournalService;
  let auditRepo: { find: jest.Mock };
  let usersRepo: { find: jest.Mock };
  let publishersRepo: { find: jest.Mock };

  beforeEach(async () => {
    auditRepo = { find: jest.fn().mockResolvedValue([]) };
    usersRepo = { find: jest.fn().mockResolvedValue([]) };
    publishersRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
      ],
    }).compile();

    service = module.get(JournalService);
  });

  const whereOf = (call: any) => call[0].where;

  it('never reaches outside the congregation', async () => {
    await service.find('cong-1', {});
    expect(whereOf(auditRepo.find.mock.calls[0])[0].congregationId).toBe(
      'cong-1',
    );
  });

  it('asks for one more row than the page, to know whether there is another', async () => {
    await service.find('cong-1', { limit: 10 });
    expect(auditRepo.find.mock.calls[0][0].take).toBe(11);
  });

  it('returns a cursor only when a further page exists', async () => {
    auditRepo.find.mockResolvedValue([row({ id: 'a1' }), row({ id: 'a2' })]);
    const one = await service.find('cong-1', { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).toBe('2026-07-21T10:00:00.000Z');

    auditRepo.find.mockResolvedValue([row()]);
    const last = await service.find('cong-1', { limit: 5 });
    expect(last.nextCursor).toBeNull();
  });

  it('caps an outsized limit rather than trusting it', async () => {
    await service.find('cong-1', { limit: 5000 });
    expect(auditRepo.find.mock.calls[0][0].take).toBe(201);
  });

  it('looks for a person on both sides — as actor and as subject', async () => {
    await service.find('cong-1', { personId: 'p-9' });
    const conditions = whereOf(auditRepo.find.mock.calls[0]);
    expect(conditions).toHaveLength(2);
    expect(conditions[0].subjectId).toBe('p-9');
    expect(conditions[1].entityId).toBe('p-9');
  });

  it('combines a date range with a cursor instead of losing one', async () => {
    await service.find('cong-1', {
      from: '2026-07-01T00:00:00Z',
      before: '2026-07-20T00:00:00Z',
    });
    // Both bounds have to survive, or paging through a filtered range walks
    // straight out of the range.
    expect(whereOf(auditRepo.find.mock.calls[0])[0].createdAt).toBeDefined();
  });

  it('names an actor from the publisher card behind the account', async () => {
    auditRepo.find.mockResolvedValue([row()]);
    usersRepo.find.mockResolvedValue([
      { id: 'user-1', email: 'ivan@example.org' },
    ]);
    publishersRepo.find.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.userId
          ? [
              {
                id: 'pub-7',
                userId: 'user-1',
                firstName: 'Иван',
                lastName: 'Петров',
              },
            ]
          : [{ id: 'pub-1', firstName: 'Пётр', lastName: 'Сидоров' }],
      ),
    );

    const page = await service.find('cong-1', {});

    expect(page.items[0].actor).toEqual({ id: 'user-1', name: 'Петров Иван' });
    expect(page.items[0].subject).toEqual({
      id: 'pub-1',
      name: 'Сидоров Пётр',
    });
  });

  it('falls back to the address when an account has no card', async () => {
    auditRepo.find.mockResolvedValue([row({ subjectId: null })]);
    usersRepo.find.mockResolvedValue([
      { id: 'user-1', email: 'ivan@example.org' },
    ]);

    const page = await service.find('cong-1', {});
    expect(page.items[0].actor?.name).toBe('ivan@example.org');
  });

  it('reports a system change as having no actor at all', async () => {
    auditRepo.find.mockResolvedValue([
      row({ actorUserId: null, source: 'system' }),
    ]);
    const page = await service.find('cong-1', {});
    expect(page.items[0].actor).toBeNull();
    expect(page.items[0].source).toBe('system');
  });

  it('parses event detail and survives nonsense in it', async () => {
    auditRepo.find.mockResolvedValue([
      row({ action: 'DENY', afterJson: '{"reason":"past_frozen"}' }),
      row({ id: 'a2', afterJson: 'not json at all' }),
    ]);
    const page = await service.find('cong-1', {});
    expect(page.items[0].detail).toEqual({ reason: 'past_frozen' });
    expect(page.items[1].detail).toBeNull();
  });

  it('marks a redacted entry so the screen can say why it is empty', async () => {
    auditRepo.find.mockResolvedValue([
      row({ redactedAt: new Date(), changedFields: [] }),
    ]);
    const page = await service.find('cong-1', {});
    expect(page.items[0].redacted).toBe(true);
  });
});
