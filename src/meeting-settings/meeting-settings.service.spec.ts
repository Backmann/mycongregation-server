import { ConflictException, NotFoundException } from '@nestjs/common';
import { LessThanOrEqual } from 'typeorm';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeetingSettingsService } from './meeting-settings.service';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { clockStub } from '../common/testing/clock-stub';
import { CongregationClock } from '../common/congregation-clock.service';

describe('MeetingSettingsService', () => {
  let service: MeetingSettingsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let congRepo: { findOne: jest.Mock; save: jest.Mock };
  let attendanceRepo: { find: jest.Mock };

  beforeEach(async () => {
    attendanceRepo = { find: jest.fn().mockResolvedValue([]) };
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: x.id ?? 'm1', ...x })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    congRepo = {
      findOne: jest.fn(),
      save: jest.fn((x) => Promise.resolve(x)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logEvent: jest.fn(),
            logFieldsChanged: jest.fn(),
          },
        },
        MeetingSettingsService,
        { provide: CongregationClock, useValue: clockStub() },
        { provide: getRepositoryToken(MeetingSettings), useValue: repo },
        { provide: getRepositoryToken(Congregation), useValue: congRepo },
        {
          provide: getRepositoryToken(MeetingAttendance),
          useValue: attendanceRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(MeetingSettingsService);
  });

  const dto = {
    effectiveFrom: '2026-01-01',
    midweekDow: 3,
    midweekTime: '19:00',
    weekendDow: 7,
    weekendTime: '13:00',
    address: 'Bunsenstr. 46, 59229 Ahlen',
  };

  it('upsert creates a new version when none exists (mic default 2)', async () => {
    repo.findOne.mockResolvedValue(null);
    const res = await service.upsert('c1', dto);
    expect(repo.create).toHaveBeenCalled();
    expect(res.microphoneSlots).toBe(2);
    expect(res.midweekDow).toBe(3);
  });

  it('upsert updates the existing version for the same effectiveFrom', async () => {
    repo.findOne.mockResolvedValue({
      id: 'm1',
      congregationId: 'c1',
      effectiveFrom: '2026-01-01',
    });
    const res = await service.upsert('c1', {
      ...dto,
      midweekDow: 4,
      microphoneSlots: 3,
    });
    expect(repo.create).not.toHaveBeenCalled();
    expect(res.id).toBe('m1');
    expect(res.midweekDow).toBe(4);
    expect(res.microphoneSlots).toBe(3);
  });

  it('getEffective returns the latest version on/before the date', async () => {
    repo.find.mockResolvedValue([{ id: 'm1', effectiveFrom: '2026-01-01' }]);
    const res = await service.getEffective('c1', '2026-05-20');
    expect(repo.find).toHaveBeenCalled();
    expect(res?.id).toBe('m1');
  });

  it('getEffective returns null when there is no version', async () => {
    repo.find.mockResolvedValue([]);
    expect(await service.getEffective('c1', '2026-05-20')).toBeNull();
  });

  it('updateCongregation sets name and timezone', async () => {
    congRepo.findOne.mockResolvedValue({
      id: 'c1',
      name: 'Old',
      timezone: null,
    });
    const res = await service.updateCongregation('c1', {
      name: 'Ahlen-Russisch',
      timezone: 'Europe/Berlin',
    });
    expect(res.name).toBe('Ahlen-Russisch');
    expect(res.timezone).toBe('Europe/Berlin');
  });

  it('overview bundles congregation, versions and effective', async () => {
    congRepo.findOne.mockResolvedValue({
      id: 'c1',
      name: 'Ahlen-Russisch',
      timezone: 'Europe/Berlin',
    });
    repo.find.mockResolvedValue([{ id: 'm1', effectiveFrom: '2026-01-01' }]);
    const res = await service.overview('c1');
    expect(res.congregation.name).toBe('Ahlen-Russisch');
    expect(Array.isArray(res.versions)).toBe(true);
    expect(res.effective?.id).toBe('m1');
  });

  describe('remove: only a version that has not started yet', () => {
    // 22:30 UTC on 25 September is already 00:30 on the 26th in Berlin — the
    // congregation's day decides, not the server's.
    beforeEach(() => {
      jest.useFakeTimers({ now: Date.parse('2026-09-25T22:30:00Z') });
    });
    afterEach(() => jest.useRealTimers());

    it('deletes a version that starts tomorrow', async () => {
      const row = {
        id: 'v2',
        congregationId: 'cong-1',
        effectiveFrom: '2026-09-27',
      };
      repo.findOne.mockResolvedValue(row);
      await service.remove('cong-1', 'v2');
      expect(repo.remove).toHaveBeenCalledWith(row);
    });

    it.each([
      ['starts today by the congregation clock', '2026-09-26'],
      ['is in force', '2026-01-01'],
    ])('refuses a version that %s', async (_label, effectiveFrom) => {
      repo.findOne.mockResolvedValue({
        id: 'v1',
        congregationId: 'cong-1',
        effectiveFrom,
      });
      await expect(service.remove('cong-1', 'v1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('answers 404 for a version of another congregation', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('cong-1', 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // «Сейчас действует» is read by the week, as week-rules reads it: on
  // Thursday 24 September a version dated Wednesday 23rd is not yet in force
  // (it starts on Monday 28th).
  it('the version in force is asked for the Monday of the week', async () => {
    repo.find.mockResolvedValue([]);
    await service.getEffective('c1', '2026-09-24');
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          effectiveFrom: LessThanOrEqual('2026-09-21'),
        }),
      }),
    );
  });

  describe('a version dated in the past (26 September)', () => {
    // clockStub's today — the weeks before it have begun.
    const inForce = {
      id: 'v1',
      congregationId: 'c1',
      effectiveFrom: '2025-01-06',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '13:00',
      address: 'Bunsenstr. 46, 59229 Ahlen',
      microphoneSlots: 2,
    };

    it('refuses to move meetings off a weekday with recorded attendance unless confirmed', async () => {
      repo.find.mockResolvedValue([inForce]);
      const today = await clockStub().todayFor('c1');
      // A Wednesday meeting recorded in the week before today.
      const monday = new Date(`${today}T00:00:00Z`);
      monday.setUTCDate(
        monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7,
      );
      const wed = new Date(monday);
      wed.setUTCDate(wed.getUTCDate() + 2);
      attendanceRepo.find.mockResolvedValue([
        { date: wed.toISOString().slice(0, 10), eventType: 'midweek' },
      ]);
      const moved = {
        ...dto,
        effectiveFrom: monday.toISOString().slice(0, 10),
        midweekDow: 4,
      };
      repo.findOne.mockResolvedValue(null);
      await expect(service.upsert('c1', moved)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
      await service.upsert('c1', { ...moved, confirmPast: true });
      expect(repo.save).toHaveBeenCalled();
    });

    it('saves a past-dated change of time without asking (nothing is left behind)', async () => {
      repo.find.mockResolvedValue([inForce]);
      attendanceRepo.find.mockResolvedValue([
        { date: '2025-01-08', eventType: 'midweek' },
      ]);
      repo.findOne.mockResolvedValue(null);
      await service.upsert('c1', {
        ...dto,
        effectiveFrom: '2025-01-06',
        midweekTime: '19:30',
      });
      expect(repo.save).toHaveBeenCalled();
    });
  });
});
