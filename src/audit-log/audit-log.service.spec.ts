import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { AuditLogService } from './audit-log.service';

type MockRepo<T extends object = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const makeRepo = <T extends object = any>(): MockRepo<T> => ({
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn().mockImplementation((x) => x),
  delete: jest.fn(),
});

describe('AuditLogService', () => {
  let service: AuditLogService;
  let auditRepo: MockRepo<AuditLog>;
  let publishersRepo: MockRepo<Publisher>;

  beforeEach(async () => {
    auditRepo = makeRepo();
    publishersRepo = makeRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Publisher), useValue: publishersRepo },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  describe('cleanupOldAuditLogs', () => {
    it('deletes rows older than the retention window and returns the count', async () => {
      auditRepo.delete!.mockResolvedValue({ affected: 7 });
      const deleted = await service.cleanupOldAuditLogs(365);
      expect(deleted).toBe(7);
      expect(auditRepo.delete).toHaveBeenCalledTimes(1);
      const arg = (auditRepo.delete as jest.Mock).mock.calls[0][0];
      expect(arg).toHaveProperty('createdAt');
    });

    it('returns 0 when the driver reports no affected count', async () => {
      auditRepo.delete!.mockResolvedValue({});
      const deleted = await service.cleanupOldAuditLogs();
      expect(deleted).toBe(0);
    });
  });

  describe('logUpdate', () => {
    it('writes a row when at least one field changed', async () => {
      await service.logUpdate({
        tenantId: 'cong-1',
        entityType: 'ServiceReport',
        entityId: 'r-1',
        actorUserId: 'u-1',
        before: { bibleStudies: 2, notes: 'same' },
        after: { bibleStudies: 3, notes: 'same' },
        fields: ['bibleStudies', 'notes'],
      });

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          congregationId: 'cong-1',
          entityType: 'ServiceReport',
          entityId: 'r-1',
          action: 'UPDATE',
          actorUserId: 'u-1',
          changedFields: ['bibleStudies'],
          beforeJson: JSON.stringify({ bibleStudies: 2 }),
          afterJson: JSON.stringify({ bibleStudies: 3 }),
        }),
      );
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('is a no-op when no fields changed (no row written)', async () => {
      await service.logUpdate({
        tenantId: 'cong-1',
        entityType: 'ServiceReport',
        entityId: 'r-1',
        actorUserId: 'u-1',
        before: { bibleStudies: 2, notes: 'same' },
        after: { bibleStudies: 2, notes: 'same' },
        fields: ['bibleStudies', 'notes'],
      });

      expect(auditRepo.create).not.toHaveBeenCalled();
      expect(auditRepo.save).not.toHaveBeenCalled();
    });

    it('captures multiple changed fields and skips unchanged ones', async () => {
      await service.logUpdate({
        tenantId: 'cong-1',
        entityType: 'ServiceReport',
        entityId: 'r-1',
        actorUserId: 'u-1',
        before: { a: 1, b: 'x', c: true },
        after: { a: 2, b: 'x', c: false },
        fields: ['a', 'b', 'c'],
      });

      const call = (auditRepo.create as jest.Mock).mock.calls[0][0];
      expect(call.changedFields).toEqual(['a', 'c']);
      expect(JSON.parse(call.beforeJson)).toEqual({ a: 1, c: true });
      expect(JSON.parse(call.afterJson)).toEqual({ a: 2, c: false });
    });

    it('normalises undefined to null in the diff snapshots', async () => {
      await service.logUpdate({
        tenantId: 'cong-1',
        entityType: 'ServiceReport',
        entityId: 'r-1',
        actorUserId: 'u-1',
        before: { notes: undefined },
        after: { notes: 'new value' },
        fields: ['notes'],
      });

      const call = (auditRepo.create as jest.Mock).mock.calls[0][0];
      expect(JSON.parse(call.beforeJson)).toEqual({ notes: null });
      expect(JSON.parse(call.afterJson)).toEqual({ notes: 'new value' });
    });

    it('respects the explicit fields list (ignores extras present in before/after)', async () => {
      await service.logUpdate({
        tenantId: 'cong-1',
        entityType: 'ServiceReport',
        entityId: 'r-1',
        actorUserId: 'u-1',
        before: { a: 1, ignored: 'old' } as any,
        after: { a: 2, ignored: 'new' } as any,
        fields: ['a'],
      });

      const call = (auditRepo.create as jest.Mock).mock.calls[0][0];
      expect(call.changedFields).toEqual(['a']);
      expect(JSON.parse(call.beforeJson)).toEqual({ a: 1 });
    });
  });

  describe('findForEntity', () => {
    it('returns rows newest-first with parsed JSON and enriched actorName', async () => {
      const now = new Date('2026-05-15T12:00:00Z');
      auditRepo.find!.mockResolvedValue([
        {
          id: 'a-1',
          action: 'UPDATE',
          actorUserId: 'u-1',
          changedFields: ['bibleStudies'],
          beforeJson: JSON.stringify({ bibleStudies: 2 }),
          afterJson: JSON.stringify({ bibleStudies: 3 }),
          createdAt: now,
        },
      ]);
      publishersRepo.find!.mockResolvedValue([
        { userId: 'u-1', displayName: 'Test Editor' },
      ]);

      const result = await service.findForEntity(
        'cong-1',
        'ServiceReport',
        'r-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'a-1',
        action: 'UPDATE',
        actorUserId: 'u-1',
        actorName: 'Test Editor',
        changedFields: ['bibleStudies'],
        before: { bibleStudies: 2 },
        after: { bibleStudies: 3 },
        createdAt: now.toISOString(),
      });
      expect(auditRepo.find).toHaveBeenCalledWith({
        where: {
          congregationId: 'cong-1',
          entityType: 'ServiceReport',
          entityId: 'r-1',
        },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns an empty array (and skips publisher lookup) when there are no logs', async () => {
      auditRepo.find!.mockResolvedValue([]);
      const result = await service.findForEntity(
        'cong-1',
        'ServiceReport',
        'r-1',
      );
      expect(result).toEqual([]);
      expect(publishersRepo.find).not.toHaveBeenCalled();
    });

    it('falls back to actorName=null when no publisher exists for the actor', async () => {
      auditRepo.find!.mockResolvedValue([
        {
          id: 'a-1',
          action: 'UPDATE',
          actorUserId: 'u-orphan',
          changedFields: ['notes'],
          beforeJson: null,
          afterJson: JSON.stringify({ notes: 'new' }),
          createdAt: new Date('2026-05-15T12:00:00Z'),
        },
      ]);
      publishersRepo.find!.mockResolvedValue([]);

      const result = await service.findForEntity(
        'cong-1',
        'ServiceReport',
        'r-1',
      );
      expect(result[0].actorName).toBeNull();
      expect(result[0].before).toBeNull();
      expect(result[0].after).toEqual({ notes: 'new' });
    });

    it('handles null changedFields gracefully (defaults to empty array)', async () => {
      auditRepo.find!.mockResolvedValue([
        {
          id: 'a-1',
          action: 'UPDATE',
          actorUserId: 'u-1',
          changedFields: null,
          beforeJson: null,
          afterJson: null,
          createdAt: new Date('2026-05-15T12:00:00Z'),
        },
      ]);
      publishersRepo.find!.mockResolvedValue([]);

      const result = await service.findForEntity(
        'cong-1',
        'ServiceReport',
        'r-1',
      );
      expect(result[0].changedFields).toEqual([]);
    });
  });
});
