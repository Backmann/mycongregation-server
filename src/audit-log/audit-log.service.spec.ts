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

  describe('logFieldsChanged — the fact, not the values', () => {
    it('records which fields changed and keeps neither side', async () => {
      await service.logFieldsChanged({
        tenantId: 'cong-1',
        entityType: 'publisher',
        entityId: 'pub-1',
        actorUserId: 'user-1',
        subjectId: 'user-1',
        fields: ['mobilePhone', 'address'],
      });

      const row = (auditRepo.save as jest.Mock).mock.calls[0][0];
      expect(row.changedFields).toEqual(['mobilePhone', 'address']);
      // The whole point: no phone number is kept anywhere in the entry.
      expect(row.beforeJson).toBeNull();
      expect(row.afterJson).toBeNull();
    });

    it('writes nothing when nothing changed', async () => {
      await service.logFieldsChanged({
        tenantId: 'cong-1',
        entityType: 'publisher',
        entityId: 'pub-1',
        actorUserId: 'user-1',
        fields: [],
      });
      expect(auditRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('logEvent — things that happen without changing anything', () => {
    it('records a view, naming whose card it was', async () => {
      await service.logEvent({
        tenantId: 'cong-1',
        entityType: 'publisher',
        entityId: 'pub-9',
        action: 'VIEW',
        actorUserId: 'elder-1',
        subjectId: 'user-9',
        detail: { document: 'S-21', serviceYear: 2026 },
      });

      const row = (auditRepo.save as jest.Mock).mock.calls[0][0];
      expect(row.action).toBe('VIEW');
      expect(row.subjectId).toBe('user-9');
      expect(JSON.parse(row.afterJson)).toEqual({
        document: 'S-21',
        serviceYear: 2026,
      });
      expect(row.changedFields).toEqual([]);
    });

    it('records a refusal, which used to vanish entirely', async () => {
      await service.logEvent({
        tenantId: 'cong-1',
        entityType: 'duty',
        entityId: 'duty-3',
        action: 'DENY',
        actorUserId: 'user-2',
        detail: { reason: 'past_frozen' },
      });
      const row = (auditRepo.save as jest.Mock).mock.calls[0][0];
      expect(row.action).toBe('DENY');
      expect(JSON.parse(row.afterJson).reason).toBe('past_frozen');
    });
  });

  describe('redactForPerson — erasure empties entries but keeps them', () => {
    const row = (over: Partial<AuditLog> = {}) =>
      ({
        id: 'a1',
        congregationId: 'cong-1',
        entityType: 'publisher',
        entityId: 'pub-1',
        action: 'UPDATE',
        actorUserId: 'user-1',
        subjectId: null,
        beforeJson: '{"mobilePhone":"+49..."}',
        afterJson: '{"mobilePhone":"+49..."}',
        changedFields: ['mobilePhone'],
        redactedAt: null,
        createdAt: new Date(),
        ...over,
      }) as AuditLog;

    it('clears the values and marks the entry, without deleting it', async () => {
      const entry = row();
      (auditRepo.find as jest.Mock).mockResolvedValue([entry]);

      const count = await service.redactForPerson('cong-1', ['user-1']);

      expect(count).toBe(1);
      expect(entry.beforeJson).toBeNull();
      expect(entry.afterJson).toBeNull();
      // Field names go too: "the phone was changed" is itself telling.
      expect(entry.changedFields).toEqual([]);
      expect(entry.redactedAt).toBeInstanceOf(Date);
      // The row survives — someone else's actions must not disappear with it.
      expect(auditRepo.delete).not.toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('leaves an already redacted entry alone', async () => {
      (auditRepo.find as jest.Mock).mockResolvedValue([
        row({ redactedAt: new Date('2026-01-01') }),
      ]);
      await expect(service.redactForPerson('cong-1', ['user-1'])).resolves.toBe(
        0,
      );
      expect(auditRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when given no one', async () => {
      await expect(service.redactForPerson('cong-1', [])).resolves.toBe(0);
      expect(auditRepo.find).not.toHaveBeenCalled();
    });
  });
});
