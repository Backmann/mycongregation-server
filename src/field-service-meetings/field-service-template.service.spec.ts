import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FieldServiceTemplateService } from './field-service-template.service';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';

const CONG = 'cong-1';

// Default template: 1st/2nd Saturday → Hamm, 3rd/4th/5th Saturday → Ahlen.
const TEMPLATE = [
  {
    ordinal: 1,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Hamm',
    position: 0,
  },
  {
    ordinal: 2,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Hamm',
    position: 1,
  },
  {
    ordinal: 3,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Ahlen',
    position: 2,
  },
  {
    ordinal: 4,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Ahlen',
    position: 3,
  },
  {
    ordinal: 5,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Ahlen',
    position: 4,
  },
];

describe('FieldServiceTemplateService.generate', () => {
  let service: FieldServiceTemplateService;
  let slotRepo: { find: jest.Mock };
  let meetingRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock };

  const build = async (slots: unknown[], existing: unknown[] = []) => {
    slotRepo = { find: jest.fn().mockResolvedValue(slots) };
    meetingRepo = {
      find: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation(async (x) => x),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FieldServiceTemplateService,
        {
          provide: getRepositoryToken(FieldServiceTemplateSlot),
          useValue: slotRepo,
        },
        {
          provide: getRepositoryToken(FieldServiceMeeting),
          useValue: meetingRepo,
        },
      ],
    }).compile();
    service = moduleRef.get(FieldServiceTemplateService);
  };

  it('materializes all five Saturdays of a 5-Saturday month', async () => {
    // August 2026 starts on a Saturday → Sat 1, 8, 15, 22, 29.
    await build(TEMPLATE);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 5, skipped: 0 });
    const saved = meetingRepo.save.mock.calls[0][0] as Array<{
      weekStartDate: string;
      dayOfWeek: number;
      address: string;
      conductorPublisherId: null;
    }>;
    // Monday of the week containing Sat Aug 1 is Mon Jul 27.
    expect(saved[0].weekStartDate).toBe('2026-07-27');
    expect(saved[0].address).toBe('Hamm');
    expect(saved.every((m) => m.dayOfWeek === 6)).toBe(true);
    expect(saved.every((m) => m.conductorPublisherId === null)).toBe(true);
    // 5th Saturday (Aug 29) → Monday Aug 24, Ahlen.
    expect(saved[4].weekStartDate).toBe('2026-08-24');
    expect(saved[4].address).toBe('Ahlen');
  });

  it('skips the 5th-Saturday slot in a 4-Saturday month', async () => {
    // March 2026 has only four Saturdays (7, 14, 21, 28).
    await build(TEMPLATE);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 3,
      months: 1,
    });
    expect(res).toEqual({ created: 4, skipped: 0 });
  });

  it('skips meetings that already exist on the same week/day/time', async () => {
    await build(TEMPLATE, [
      { weekStartDate: '2026-07-27', dayOfWeek: 6, startTime: '10:30' },
    ]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 4, skipped: 1 });
  });

  it('spans multiple months', async () => {
    await build(TEMPLATE);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8, // 5 Saturdays
      months: 2, // + September 2026 (4 Saturdays)
    });
    expect(res.created).toBe(9);
    expect(res.skipped).toBe(0);
  });

  it('returns zero for an empty template without saving', async () => {
    await build([]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 0, skipped: 0 });
    expect(meetingRepo.save).not.toHaveBeenCalled();
  });
});
