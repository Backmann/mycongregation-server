import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MeetingSettingsService } from './meeting-settings.service';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';

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

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
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
        { provide: getRepositoryToken(MeetingSettings), useValue: repo },
        { provide: getRepositoryToken(Congregation), useValue: congRepo },
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
});
