import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FieldServiceTemplateService } from './field-service-template.service';
import { FieldServiceTemplateSlot } from '../entities/field-service-template-slot.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { clockStub } from '../common/testing/clock-stub';
import { FieldServiceSettings } from '../entities/field-service-settings.entity';
import { ServiceGroup } from '../entities/service-group.entity';

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

describe('FieldServiceTemplateService.generate (retired)', () => {
  it('refuses, and says to prepare the month instead', () => {
    const service = new FieldServiceTemplateService(
      {} as never,
      {} as never,
      {} as never,
      clockStub(),
      {} as never,
      {} as never,
    );
    expect(() => service.generate()).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'FS_GENERATE_RETIRED' }),
      }),
    );
  });
});

describe('FieldServiceTemplateService.replaceSlots', () => {
  it('writes the previous template into the journal before it goes', async () => {
    // «Сохранить» takes the old template with it — there is no version of a
    // template to go back to, so the journal is the only place a person can
    // read what stood there and type it back.
    const before = [
      {
        ordinal: 1,
        ordinals: [1],
        lastOnly: false,
        dayOfWeek: 6,
        startTime: '10:30',
        address: 'Зал',
        serviceGroupId: null,
        conductorRule: 'none',
      },
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
      {} as never,
      { find: jest.fn(async () => []) } as never,
    );

    await service.replaceSlots('cong-1', { slots: [] } as never);

    expect(audit.logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'field_service_template',
        before: {
          slots: JSON.stringify([
            {
              ordinals: [1],
              lastOnly: false,
              dayOfWeek: 6,
              startTime: '10:30',
              address: 'Зал',
              serviceGroupId: null,
              conductorRule: 'none',
            },
          ]),
        },
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
      {} as never,
      { find: jest.fn(async () => []) } as never,
    );

    await service.replaceSlots('cong-1', {
      slots: [{ ordinal: 1, dayOfWeek: 6, startTime: '10:30', address: 'Зал' }],
    } as never);

    expect(inside).toEqual(['delete', 'save']);
    expect(slotRepo.delete).not.toHaveBeenCalled();
    expect(slotRepo.save).not.toHaveBeenCalled();
  });
});

describe('FieldServiceTemplateService.replaceSlots — the two shapes', () => {
  const make = (groups: unknown[] = []) => {
    const written: unknown[] = [];
    const txRepo = {
      delete: jest.fn(),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown[]) => written.push(...x)),
    };
    const slotRepo: any = {
      find: jest.fn(async () => []),
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
      {} as never,
      { find: jest.fn(async () => groups) } as never,
    );
    return { service, written };
  };

  it('the old shape is stored as one ordinal, a general meeting, nobody picked', async () => {
    const { service, written } = make();
    await service.replaceSlots('cong-1', {
      slots: [{ ordinal: 3, dayOfWeek: 6, startTime: '10:30', address: 'Зал' }],
    } as never);
    expect(written[0]).toMatchObject({
      ordinal: 3,
      ordinals: [3],
      lastOnly: false,
      address: 'Зал',
      serviceGroupId: null,
      conductorRule: 'none',
    });
  });

  it('the new shape keeps every occurrence, the group, its rule; «ordinal» is the first', async () => {
    const { service, written } = make([{ id: 'g-1' }]);
    await service.replaceSlots('cong-1', {
      slots: [
        {
          ordinals: [3, 1],
          lastOnly: true,
          dayOfWeek: 6,
          startTime: '10:00',
          serviceGroupId: 'g-1',
          conductorRule: 'group_overseer',
        },
        { lastOnly: true, dayOfWeek: 7, startTime: '09:00', address: 'Парк' },
      ],
    } as never);
    expect(written[0]).toMatchObject({
      ordinal: 1,
      ordinals: [1, 3],
      lastOnly: true,
      address: null,
      serviceGroupId: 'g-1',
      conductorRule: 'group_overseer',
    });
    // «The last» alone: the nearest the old shape can say is the 5th.
    expect(written[1]).toMatchObject({
      ordinal: 5,
      ordinals: [],
      lastOnly: true,
    });
  });

  it('refuses a slot on no day, a general meeting with nowhere, a stranger’s group', async () => {
    const { service, written } = make([{ id: 'g-1' }]);
    const attempt = (s: Record<string, unknown>) =>
      service.replaceSlots('cong-1', { slots: [s] } as never);
    await expect(
      attempt({ dayOfWeek: 6, startTime: '10:30', address: 'Зал' }),
    ).rejects.toThrow(/which occurrences/);
    await expect(
      attempt({ ordinals: [1], dayOfWeek: 6, startTime: '10:30' }),
    ).rejects.toThrow(/where it is held/);
    await expect(
      attempt({
        ordinals: [1],
        dayOfWeek: 6,
        startTime: '10:30',
        serviceGroupId: 'g-other',
      }),
    ).rejects.toThrow(/No such service group/);
    expect(written).toEqual([]);
  });

  it('three kinds: no group means the general one unless the slot says «by groups», which needs no place', async () => {
    const { service, written } = make([{ id: 'g-1' }]);
    await service.replaceSlots('cong-1', {
      slots: [
        // The old shape and the new one without the flag: the general meeting.
        { ordinal: 1, dayOfWeek: 6, startTime: '10:30', address: 'Зал' },
        // By groups: each at its own place, so no address is fine.
        { ordinals: [2], dayOfWeek: 6, startTime: '10:30', isGeneral: false },
        // A group's own: never general, whatever the flag says.
        {
          ordinals: [3],
          dayOfWeek: 6,
          startTime: '10:00',
          serviceGroupId: 'g-1',
          isGeneral: true,
        },
      ],
    } as never);
    expect(
      (written as Record<string, unknown>[]).map((w) => [
        w.isGeneral,
        w.serviceGroupId,
        w.address,
      ]),
    ).toEqual([
      [true, null, 'Зал'],
      [false, null, null],
      [false, 'g-1', null],
    ]);
  });
});
