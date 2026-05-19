import { ActivityFeedService } from './activity-feed.service';
import { AuditLog } from '../entities/audit-log.entity';

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;
  let auditRepo: any;
  let userRepo: any;
  let publisherRepo: any;
  let reportRepo: any;

  beforeEach(() => {
    auditRepo = { find: jest.fn() };
    userRepo = { findBy: jest.fn().mockResolvedValue([]) };
    publisherRepo = { findBy: jest.fn().mockResolvedValue([]) };
    reportRepo = { findBy: jest.fn().mockResolvedValue([]) };

    service = new ActivityFeedService(
      auditRepo,
      userRepo,
      publisherRepo,
      reportRepo,
    );
  });

  function makeAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
    return {
      id: 'audit-1',
      congregationId: 'cong-1',
      entityType: 'publisher',
      entityId: 'pub-1',
      action: 'update',
      actorUserId: 'user-1',
      beforeJson: null,
      afterJson: null,
      changedFields: [],
      createdAt: new Date('2026-05-15T10:00:00Z'),
      ...overrides,
    } as AuditLog;
  }

  it('returns empty feed when no audit entries', async () => {
    auditRepo.find.mockResolvedValue([]);
    const result = await service.findFeed('cong-1', {});
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('formats status change with old and new status', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        beforeJson: JSON.stringify({ status: 'inactive' }),
        afterJson: JSON.stringify({ status: 'active' }),
      }),
    ]);
    userRepo.findBy.mockResolvedValue([
      { id: 'user-1', firstName: 'John', lastName: 'Doe' },
    ]);
    publisherRepo.findBy.mockResolvedValue([
      { id: 'pub-1', displayName: 'Brother Smith' },
    ]);

    const result = await service.findFeed('cong-1', {});
    expect(result.items[0].type).toBe('status_change');
    expect(result.items[0].oldStatus).toBe('inactive');
    expect(result.items[0].newStatus).toBe('active');
    expect(result.items[0].publisherName).toBe('Brother Smith');
    expect(result.items[0].summary).toContain('inactive');
    expect(result.items[0].summary).toContain('active');
    expect(result.items[0].summary).toContain('Brother Smith');
  });

  it('formats override applied with actor name', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        beforeJson: JSON.stringify({
          statusManuallyOverridden: false,
          status: 'inactive',
        }),
        afterJson: JSON.stringify({
          statusManuallyOverridden: true,
          status: 'active',
        }),
      }),
    ]);
    userRepo.findBy.mockResolvedValue([
      { id: 'user-1', firstName: 'Jane', lastName: 'Admin' },
    ]);
    publisherRepo.findBy.mockResolvedValue([
      { id: 'pub-1', displayName: 'Brother Lee' },
    ]);

    const result = await service.findFeed('cong-1', {});
    expect(result.items[0].type).toBe('override_applied');
    expect(result.items[0].actorName).toBe('Jane Admin');
    expect(result.items[0].summary).toContain('Jane Admin');
    expect(result.items[0].summary).toContain('Brother Lee');
  });

  it('formats override cleared', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        beforeJson: JSON.stringify({
          statusManuallyOverridden: true,
          status: 'active',
        }),
        afterJson: JSON.stringify({
          statusManuallyOverridden: false,
          status: 'active',
        }),
      }),
    ]);
    userRepo.findBy.mockResolvedValue([{ id: 'user-1', email: 'admin@x.com' }]);
    publisherRepo.findBy.mockResolvedValue([{ id: 'pub-1', displayName: 'P' }]);

    const result = await service.findFeed('cong-1', {});
    expect(result.items[0].type).toBe('override_cleared');
    expect(result.items[0].summary).toContain('cleared');
  });

  it('formats report_submitted with month and publisher', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        entityType: 'service_report',
        entityId: 'report-1',
        action: 'create',
      }),
    ]);
    userRepo.findBy.mockResolvedValue([{ id: 'user-1', email: 'pub@a.com' }]);
    reportRepo.findBy.mockResolvedValue([
      { id: 'report-1', publisherId: 'pub-1', reportMonth: '2026-04-01' },
    ]);
    publisherRepo.findBy.mockResolvedValue([
      { id: 'pub-1', displayName: 'Sister Anna' },
    ]);

    const result = await service.findFeed('cong-1', {});
    expect(result.items[0].type).toBe('report_submitted');
    expect(result.items[0].publisherName).toBe('Sister Anna');
    expect(result.items[0].summary).toContain('Sister Anna');
    expect(result.items[0].summary).toContain('April');
    expect(result.items[0].reportMonth).toBe('2026-04-01');
  });

  it('returns nextCursor when more pages exist', async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      makeAuditLog({
        id: `audit-${i}`,
        createdAt: new Date(Date.UTC(2026, 4, 15 - i, 10, 0, 0)),
      }),
    );
    auditRepo.find.mockResolvedValue(rows);
    publisherRepo.findBy.mockResolvedValue([{ id: 'pub-1', displayName: 'X' }]);
    userRepo.findBy.mockResolvedValue([{ id: 'user-1', email: 'a@b.com' }]);

    const result = await service.findFeed('cong-1', { limit: 20 });
    expect(result.items.length).toBe(20);
    expect(result.nextCursor).not.toBeNull();
    expect(result.nextCursor).toBe(rows[19].createdAt.toISOString());
  });

  it('returns null nextCursor on last page', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        beforeJson: JSON.stringify({ status: 'inactive' }),
        afterJson: JSON.stringify({ status: 'active' }),
      }),
    ]);
    userRepo.findBy.mockResolvedValue([{ id: 'user-1', email: 'a@b.com' }]);
    publisherRepo.findBy.mockResolvedValue([{ id: 'pub-1', displayName: 'X' }]);

    const result = await service.findFeed('cong-1', { limit: 20 });
    expect(result.nextCursor).toBeNull();
  });

  it('handles missing publisher gracefully', async () => {
    auditRepo.find.mockResolvedValue([
      makeAuditLog({
        beforeJson: JSON.stringify({ status: 'inactive' }),
        afterJson: JSON.stringify({ status: 'active' }),
      }),
    ]);
    userRepo.findBy.mockResolvedValue([{ id: 'user-1', email: 'a@b.com' }]);
    publisherRepo.findBy.mockResolvedValue([]); // publisher deleted

    const result = await service.findFeed('cong-1', {});
    expect(result.items[0].publisherName).toBe('(deleted publisher)');
  });

  it('clamps limit to max 100', async () => {
    auditRepo.find.mockResolvedValue([]);
    await service.findFeed('cong-1', { limit: 500 });
    const args = auditRepo.find.mock.calls[0][0];
    expect(args.take).toBe(101); // 100 + 1 for hasMore check
  });

  it('uses before cursor to paginate', async () => {
    auditRepo.find.mockResolvedValue([]);
    await service.findFeed('cong-1', { before: '2026-05-10T00:00:00.000Z' });
    const args = auditRepo.find.mock.calls[0][0];
    expect(args.where.createdAt).toBeDefined();
  });
});
