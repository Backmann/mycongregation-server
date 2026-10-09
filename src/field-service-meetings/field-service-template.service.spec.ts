import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FieldServiceTemplateService } from './field-service-template.service';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { clockStub } from '../common/testing/clock-stub';

const CONG = 'cong-1';

// The months below are 2026. A day already gone is not generated
// (9 October 2026), so the run is pinned to New Year unless a test says
// otherwise.
let nowSpy: jest.SpyInstance;
const pinNow = (iso: string) => nowSpy.mockReturnValue(Date.parse(iso));
beforeEach(() => {
  nowSpy = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-01-01T08:00:00Z'));
});
afterEach(() => nowSpy.mockRestore());

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
  let audit: { logUpdate: jest.Mock; logEvent: jest.Mock };

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
        {
          provide: AuditLogService,
          useValue: (audit = { logUpdate: jest.fn(), logEvent: jest.fn() }),
        },
        { provide: CongregationClock, useValue: clockStub() },
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
    expect(res).toEqual({ created: 5, skipped: 0, past: 0 });
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
    expect(res).toEqual({ created: 4, skipped: 0, past: 0 });
  });

  it('skips meetings that already exist on the same week/day/time', async () => {
    await build(TEMPLATE, [
      {
        weekStartDate: '2026-07-27',
        dayOfWeek: 6,
        startTime: '10:30',
        address: 'Somewhere else',
      },
    ]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 4, skipped: 1, past: 0 });
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

  it('does not fill days already gone — counted as past, not created', async () => {
    // Friday 9 October 2026: Saturday 3 October is behind, 10/17/24/31 ahead.
    pinNow('2026-10-09T08:00:00Z');
    await build(TEMPLATE);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 10,
      months: 1,
    });
    expect(res).toEqual({ created: 4, skipped: 0, past: 1 });
    const saved = meetingRepo.save.mock.calls[0][0] as Array<{
      weekStartDate: string;
    }>;
    expect(saved.map((m) => m.weekStartDate)).not.toContain('2026-09-28');
  });

  it('fills today — the meeting may not have started yet', async () => {
    // Saturday 3 October 2026, early morning in Berlin.
    pinNow('2026-10-03T05:00:00Z');
    await build(TEMPLATE);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 10,
      months: 1,
    });
    expect(res).toEqual({ created: 5, skipped: 0, past: 0 });
  });

  it('a slot moved by hand to another time is not made again', async () => {
    // 1st Saturday of August moved from 10:30 to 10:00, same hall.
    await build(TEMPLATE, [
      {
        weekStartDate: '2026-07-27',
        dayOfWeek: 6,
        startTime: '10:00',
        address: 'Hamm',
      },
    ]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 4, skipped: 1, past: 0 });
  });

  it('a group’s own meeting that day — other time, other place — does not block the slot', async () => {
    await build(TEMPLATE, [
      {
        weekStartDate: '2026-07-27',
        dayOfWeek: 6,
        startTime: '09:00',
        address: 'Lindenweg 5, Werne',
      },
    ]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 5, skipped: 0, past: 0 });
  });

  it('writes the run into the journal as one line', async () => {
    await build(TEMPLATE);
    await service.generate(CONG, { startYear: 2026, startMonth: 8, months: 1 });
    expect(audit.logEvent).toHaveBeenCalledTimes(1);
    const call = audit.logEvent.mock.calls[0][0];
    expect(call.entityType).toBe('field_service_meeting');
    expect(call.action).toBe('CREATE');
    expect(call.detail).toEqual(
      expect.objectContaining({ bulk: true, count: 5, fromTemplate: true }),
    );
  });

  it('writes nothing into the journal when nothing was created', async () => {
    await build(TEMPLATE, [
      {
        weekStartDate: '2026-07-27',
        dayOfWeek: 6,
        startTime: '10:30',
        address: 'Hamm',
      },
    ]);
    await service.generate(CONG, { startYear: 2026, startMonth: 3, months: 0 });
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('returns zero for an empty template without saving', async () => {
    await build([]);
    const res = await service.generate(CONG, {
      startYear: 2026,
      startMonth: 8,
      months: 1,
    });
    expect(res).toEqual({ created: 0, skipped: 0, past: 0 });
    expect(meetingRepo.save).not.toHaveBeenCalled();
  });
});

describe('FieldServiceTemplateService.replaceSlots', () => {
  it('writes the previous template into the journal before it goes', async () => {
    // «Сохранить» takes the old template with it — there is no version of a
    // template to go back to, so the journal is the only place a person can
    // read what stood there and type it back.
    const before = [
      { ordinal: 1, dayOfWeek: 6, startTime: '10:30', address: 'Зал' },
    ];
    let call = 0;
    const slotRepo: any = {
      find: jest.fn(async () => (call++ === 0 ? before : [])),
      delete: jest.fn(async () => ({ affected: 1 })),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
    };
    slotRepo.manager = {
      transaction: async (fn: (em: unknown) => Promise<void>) =>
        fn({ getRepository: () => slotRepo }),
    };
    const audit = { logUpdate: jest.fn(), logEvent: jest.fn() };
    const service = new FieldServiceTemplateService(
      slotRepo,
      { find: jest.fn(), create: jest.fn(), save: jest.fn() } as never,
      audit as never,
      clockStub(),
    );

    await service.replaceSlots('cong-1', { slots: [] } as never);

    expect(audit.logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'field_service_template',
        before: { slots: JSON.stringify(before) },
      }),
    );
  });

  it('deletes and writes the new template inside one transaction', async () => {
    // Apart, a failed insert left the congregation with no template at all.
    const inside: string[] = [];
    const txRepo = {
      delete: jest.fn(async () => inside.push('delete')),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => inside.push('save') && x),
    };
    const slotRepo: any = {
      find: jest.fn(async () => []),
      delete: jest.fn(),
      save: jest.fn(),
      manager: {
        transaction: async (fn: (em: unknown) => Promise<void>) =>
          fn({ getRepository: () => txRepo }),
      },
    };
    const service = new FieldServiceTemplateService(
      slotRepo,
      {} as never,
      { logUpdate: jest.fn(), logEvent: jest.fn() } as never,
      clockStub(),
    );

    await service.replaceSlots('cong-1', {
      slots: [{ ordinal: 1, dayOfWeek: 6, startTime: '10:30', address: 'Зал' }],
    } as never);

    expect(inside).toEqual(['delete', 'save']);
    expect(slotRepo.delete).not.toHaveBeenCalled();
    expect(slotRepo.save).not.toHaveBeenCalled();
  });
});
