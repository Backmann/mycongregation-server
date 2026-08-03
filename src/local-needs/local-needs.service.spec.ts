import { ForbiddenException } from '@nestjs/common';
import { LocalNeedsService } from './local-needs.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';

/**
 * The module had no tests at all, while carrying two different access rules
 * and the record the body of elders relies on to avoid repeating a subject.
 */
describe('LocalNeedsService', () => {
  let repo: any;
  let responsibilities: any;
  let audit: any;
  let service: LocalNeedsService;

  const admin = {
    id: 'u-admin',
    role: UserRole.ADMIN,
    congregationId: 'cong-1',
  } as any;
  const elder = {
    id: 'u-elder',
    role: UserRole.ELDER,
    congregationId: 'cong-1',
  } as any;
  const publisher = {
    id: 'u-pub',
    role: UserRole.PUBLISHER,
    congregationId: 'cong-1',
  } as any;

  const topic = (over: Record<string, any> = {}) => ({
    id: 'topic-1',
    congregationId: 'cong-1',
    title: 'Гостеприимство',
    notes: null,
    speakerPublisherId: null,
    usedWeek: null,
    usedAssignmentId: null,
    ...over,
  });

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (x: any) => x),
      create: jest.fn((x: any) => x),
      softDelete: jest.fn(),
      restore: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    responsibilities = { count: jest.fn().mockResolvedValue(0) };
    audit = {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logEvent: jest.fn(),
    };
    service = new LocalNeedsService(repo, responsibilities, audit, clockStub());
  });

  afterEach(() => restoreNow());

  describe('who may do what', () => {
    it('keeps the backlog away from an ordinary publisher', async () => {
      await expect(
        service.findAll('cong-1', {}, publisher),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an elder read it but not change it', async () => {
      repo.createQueryBuilder.mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      await expect(service.findAll('cong-1', {}, elder)).resolves.toEqual([]);
      await expect(
        service.create('cong-1', { title: 'X' } as any, elder),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the Life & Ministry overseer change it', async () => {
      responsibilities.count.mockResolvedValue(1);

      await expect(
        service.create('cong-1', { title: 'X' } as any, elder),
      ).resolves.toBeDefined();

      // And it is THAT responsibility being asked about, for THIS user — not
      // just any row in the table.
      const where = responsibilities.count.mock.calls[0][0].where;
      expect(where.userId).toBe('u-elder');
      expect(where.type.value).toContain(
        ResponsibilityType.LIFE_MINISTRY_OVERSEER,
      );
    });
  });

  describe('marking a topic used', () => {
    it('files it under the congregation\u2019s current week when none is named', async () => {
      // A Thursday. The week it belongs to is the Monday before it — and the
      // date comes from the server reading the congregation's clock, not from
      // whatever timezone the phone happens to be set to.
      setNow(Date.UTC(2026, 7, 6, 9, 0, 0));
      repo.findOne.mockResolvedValue(topic());

      const saved = await service.markUsed('cong-1', 'topic-1', {}, admin);

      expect(saved.usedWeek).toBe('2026-08-03');
    });

    it('snaps a named week to its Monday', async () => {
      repo.findOne.mockResolvedValue(topic());

      const saved = await service.markUsed(
        'cong-1',
        'topic-1',
        { week: '2026-07-09' }, // a Thursday
        admin,
      );

      expect(saved.usedWeek).toBe('2026-07-06');
    });

    it('remembers WHICH part of the programme it became', async () => {
      repo.findOne.mockResolvedValue(topic());

      const saved = await service.markUsed(
        'cong-1',
        'topic-1',
        { week: '2026-07-06', assignmentId: 'assignment-9' },
        admin,
      );

      expect(saved.usedAssignmentId).toBe('assignment-9');
    });

    it('puts it back in the plan with no week and no part', async () => {
      repo.findOne.mockResolvedValue(
        topic({ usedWeek: '2026-07-06', usedAssignmentId: 'assignment-9' }),
      );

      const saved = await service.markPlanned('cong-1', 'topic-1', admin);

      expect(saved.usedWeek).toBeNull();
      expect(saved.usedAssignmentId).toBeNull();
    });
  });

  describe('when the programme changes underneath it', () => {
    it('releases a topic whose part was replaced or deleted', async () => {
      // This is the whole point of holding the part's id: the topic was never
      // used, because the part it was placed in no longer carries it.
      repo.find.mockResolvedValue([
        topic({ usedWeek: '2026-07-06', usedAssignmentId: 'assignment-9' }),
      ]);

      await service.releaseAssignment('cong-1', 'assignment-9');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ usedWeek: null, usedAssignmentId: null }),
      );
    });

    it('journals the release, because nobody asked for it', async () => {
      repo.find.mockResolvedValue([
        topic({ usedWeek: '2026-07-06', usedAssignmentId: 'assignment-9' }),
      ]);

      await service.releaseAssignment('cong-1', 'assignment-9');

      expect(audit.logUpdate).toHaveBeenCalledTimes(1);
    });

    it('leaves topics bound to other parts alone', async () => {
      repo.find.mockResolvedValue([]);

      await service.releaseAssignment('cong-1', 'assignment-other');

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    it('drops the part binding when the week is cleared by hand', async () => {
      // Otherwise a topic returned to the plan would still claim to be sitting
      // in a meeting part.
      repo.findOne.mockResolvedValue(
        topic({ usedWeek: '2026-07-06', usedAssignmentId: 'assignment-9' }),
      );

      const saved = await service.update(
        'cong-1',
        'topic-1',
        { usedWeek: null } as any,
        admin,
      );

      expect(saved.usedAssignmentId).toBeNull();
    });

    it('snaps an edited week to its Monday too', async () => {
      repo.findOne.mockResolvedValue(topic());

      const saved = await service.update(
        'cong-1',
        'topic-1',
        { usedWeek: '2026-07-11' } as any, // a Saturday
        admin,
      );

      expect(saved.usedWeek).toBe('2026-07-06');
    });
  });

  describe('the archive', () => {
    it('journals a restore, the same as the delete it undoes', async () => {
      repo.findOne.mockResolvedValue(topic());
      repo.createQueryBuilder.mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(topic()),
      });

      await service.restore('cong-1', 'topic-1', admin);

      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESTORE' }),
      );
    });
  });
});
