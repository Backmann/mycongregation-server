import { FieldServicePlannerService } from './field-service-planner.service';
import {
  FieldServiceTemplateService,
  slotDatesInMonth,
} from './field-service-template.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * How a month is prepared from the template (October 2026): the calendar,
 * what already stands there, and whose turn it is.
 *
 * November 2026: Saturdays 7, 14, 21, 28. The stand's calendar: a convention
 * 20–22 November; the circuit overseer 8–13 December.
 */

const CONG = 'cong-1';
const NOW = Date.parse('2026-10-09T08:00:00Z');

const G_VERNE = 'g-verne';
const G_NORD = 'g-nord';

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  gender: 'brother' | 'sister';
  isActive: boolean;
  capabilities: Record<string, boolean>;
  removedAt: null;
};
const bro = (
  id: string,
  name: string,
  extra: Partial<Person> = {},
): Person => ({
  id,
  firstName: '',
  lastName: name,
  displayName: name,
  gender: 'brother',
  isActive: true,
  capabilities: { fs_meeting_conductor: true },
  removedAt: null,
  ...extra,
});

const PEOPLE: Person[] = [
  bro('p-vogt', 'Фогт'),
  bro('p-schmidt', 'Шмидт'),
  bro('p-becker', 'Беккер'),
  bro('p-keller', 'Келлер'),
  bro('p-hoffmann', 'Хоффман'),
  // The overseer of the Nord group is not in the circle (no switch).
  bro('p-nord-ov', 'Майер', { capabilities: {} }),
  bro('p-sister', 'Вебер', { gender: 'sister' }),
  bro('p-gone', 'Ушедший', { isActive: false }),
];

type Meeting = {
  id: string;
  weekStartDate: string;
  dayOfWeek: number;
  startTime: string;
  address: string;
  serviceGroupId: string | null;
  conductorPublisherId: string | null;
  serviceOverseerVisit: boolean;
  serviceOverseerPublisherId: string | null;
  serviceOverseerAssistantId: string | null;
  publishedAt: Date | null;
};
const meeting = (p: Partial<Meeting> & { id: string }): Meeting => ({
  weekStartDate: '2026-11-02',
  dayOfWeek: 6,
  startTime: '10:30',
  address: 'Hall',
  serviceGroupId: null,
  conductorPublisherId: null,
  serviceOverseerVisit: false,
  serviceOverseerPublisherId: null,
  serviceOverseerAssistantId: null,
  publishedAt: new Date(NOW),
  ...p,
});

type Slot = {
  id: string;
  position: number;
  ordinal: number;
  ordinals: number[];
  lastOnly: boolean;
  dayOfWeek: number;
  startTime: string;
  address: string | null;
  serviceGroupId: string | null;
  conductorRule: 'group_overseer' | 'rotation' | 'none';
};
const slot = (p: Partial<Slot> & { id: string }): Slot => ({
  position: 0,
  ordinal: 1,
  ordinals: [1, 2, 3, 4, 5],
  lastOnly: false,
  dayOfWeek: 6,
  startTime: '10:30',
  address: 'Hall',
  serviceGroupId: null,
  conductorRule: 'rotation',
  ...p,
});

const GENERAL = slot({ id: 's-general' });
const VERNE = slot({
  id: 's-verne',
  position: 1,
  ordinals: [1, 3],
  startTime: '10:00',
  address: null,
  serviceGroupId: G_VERNE,
  conductorRule: 'group_overseer',
});

function build(opts: {
  slots?: Slot[];
  meetings?: Meeting[];
  events?: Record<string, unknown>[];
  absences?: {
    publisherId: string;
    startDate: string;
    endDate: string | null;
  }[];
  people?: Person[];
  settings?: Record<string, unknown>;
  groups?: Record<string, unknown>[];
}) {
  const meetings = opts.meetings ?? [];
  const meetingRepo = {
    find: jest.fn(async () => meetings.map((m) => ({ ...m }))),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: unknown[]) =>
      v.map((x, i) => ({ id: `new-${i}`, ...(x as object) })),
    ),
  };
  const publishersRepo = {
    find: jest.fn(async () => (opts.people ?? PEOPLE).map((p) => ({ ...p }))),
  };
  const eventsRepo = {
    find: jest.fn(async () => opts.events ?? []),
  };
  const absencesRepo = {
    find: jest.fn(async () => opts.absences ?? []),
  };
  const groups = opts.groups ?? [
    {
      id: G_VERNE,
      name: 'Верне',
      overseerPublisherId: 'p-vogt',
      assistantPublisherId: 'p-schmidt',
      meetingLocation: 'Lindenweg 5',
    },
    {
      id: G_NORD,
      name: 'Север',
      overseerPublisherId: 'p-nord-ov',
      assistantPublisherId: null,
      meetingLocation: 'Ahornstraße 12',
    },
  ];
  const slotRepo = {
    find: jest.fn(async () => opts.slots ?? [GENERAL, VERNE]),
  };
  const settingsRepo = {
    findOne: jest.fn(async () => ({
      congregationId: CONG,
      skipAssemblies: true,
      coVisitFromSchedule: true,
      ...(opts.settings ?? {}),
    })),
  };
  const groupsRepo = { find: jest.fn(async () => groups) };
  const audit = { logUpdate: jest.fn(), logEvent: jest.fn() };
  const template = new FieldServiceTemplateService(
    slotRepo as any,
    meetingRepo as any,
    audit as any,
    clockStub(),
    settingsRepo as any,
    groupsRepo as any,
  );
  const planner = new FieldServicePlannerService(
    meetingRepo as any,
    publishersRepo as any,
    eventsRepo as any,
    absencesRepo as any,
    template,
    audit as any,
    clockStub(),
  );
  return { planner, meetingRepo, audit };
}

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => nowSpy.mockRestore());

const line = (r: {
  date: string;
  startTime: string;
  status: string;
  conductor: { publisherId: string } | null;
}) => `${r.date} ${r.startTime} ${r.status} ${r.conductor?.publisherId ?? '-'}`;

describe('which days a slot lands on', () => {
  it('every, the last, and the listed ones', () => {
    const base = { lastOnly: false, dayOfWeek: 6 };
    // November 2026: Saturdays 7, 14, 21, 28 — four of them.
    expect(
      slotDatesInMonth({ ...base, ordinals: [1, 2, 3, 4, 5] }, 2026, 11),
    ).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    expect(slotDatesInMonth({ ...base, ordinals: [1, 3] }, 2026, 11)).toEqual([
      '2026-11-07',
      '2026-11-21',
    ]);
    expect(
      slotDatesInMonth({ ...base, ordinals: [], lastOnly: true }, 2026, 11),
    ).toEqual(['2026-11-28']);
    // August 2026 has five Saturdays: the last is the 29th, not the 22nd.
    expect(
      slotDatesInMonth({ ...base, ordinals: [], lastOnly: true }, 2026, 8),
    ).toEqual(['2026-08-29']);
    // «The 4th and the last» in a four-Saturday month is one day, not two.
    expect(
      slotDatesInMonth({ ...base, ordinals: [4], lastOnly: true }, 2026, 11),
    ).toEqual(['2026-11-28']);
  });

  it('a row the migration has not reached still means its one ordinal', () => {
    expect(
      slotDatesInMonth(
        { ordinal: 2, ordinals: [], lastOnly: false, dayOfWeek: 6 },
        2026,
        11,
      ),
    ).toEqual(['2026-11-14']);
  });
});

describe('the calendar', () => {
  it('a convention takes its days; the overseer’s week keeps its own schedule', async () => {
    const { planner } = build({
      events: [
        {
          type: 'regional_convention',
          title: 'Конгресс',
          date: '2026-11-20',
          endDate: '2026-11-22',
        },
        {
          type: 'circuit_overseer_visit',
          title: 'Визит',
          date: '2026-12-08',
          endDate: '2026-12-13',
        },
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    const sat21 = nov.rows.filter((r) => r.date === '2026-11-21');
    expect(sat21.map((r) => r.status)).toEqual(['assembly', 'assembly']);
    expect(sat21[0].because).toBe('Конгресс');
    const dec = await planner.preview(CONG, 2026, 12);
    expect(dec.rows.find((r) => r.date === '2026-12-12')?.status).toBe(
      'co_visit',
    );
    expect(dec.rows.find((r) => r.date === '2026-12-05')?.status).toBe(
      'create',
    );
  });

  it('with the switch off, a convention day is filled like any other', async () => {
    const { planner } = build({
      events: [
        {
          type: 'regional_convention',
          title: 'Конгресс',
          date: '2026-11-20',
          endDate: '2026-11-22',
        },
      ],
      settings: { skipAssemblies: false },
    });
    const nov = await planner.preview(CONG, 2026, 11);
    expect(
      nov.rows.filter((r) => r.date === '2026-11-21').map((r) => r.status),
    ).toEqual(['create', 'create']);
  });

  it('a day already gone is not filled', async () => {
    const { planner } = build({});
    const oct = await planner.preview(CONG, 2026, 10);
    expect(oct.rows.find((r) => r.date === '2026-10-03')?.status).toBe('past');
    // Today is Friday the 9th: Saturday the 10th is still to come.
    expect(oct.rows.find((r) => r.date === '2026-10-10')?.status).toBe(
      'create',
    );
  });
});

describe('what already stands there', () => {
  it('a group with a meeting that day (a visit) is not given a second one', async () => {
    const { planner } = build({
      meetings: [
        meeting({
          id: 'visit',
          startTime: '09:00',
          address: 'elsewhere',
          serviceGroupId: G_VERNE,
          serviceOverseerVisit: true,
        }),
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    const verne7 = nov.rows.find(
      (r) => r.date === '2026-11-07' && r.serviceGroupId === G_VERNE,
    );
    expect(verne7?.status).toBe('exists');
    // The general meeting that day is another matter: another time, and the
    // visit is the group's, not everybody's.
    const general7 = nov.rows.find(
      (r) => r.date === '2026-11-07' && r.serviceGroupId === null,
    );
    expect(general7?.status).toBe('create');
  });

  it('a general meeting stands down for one at its time, or a general one at its place', async () => {
    const { planner } = build({
      meetings: [
        // Sat 7: somebody already put 10:30 at another hall.
        meeting({ id: 'same-time', address: 'Other hall' }),
        // Sat 14: the 10:30 was moved by hand to 10:00 at the same hall.
        meeting({
          id: 'moved',
          weekStartDate: '2026-11-09',
          startTime: '10:00',
          address: 'hall',
        }),
        // Sat 28: the Nord group meets at the Hall at 10:00 — not an obstacle.
        meeting({
          id: 'nord',
          weekStartDate: '2026-11-23',
          startTime: '10:00',
          address: 'Hall',
          serviceGroupId: G_NORD,
        }),
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    const general = (d: string) =>
      nov.rows.find((r) => r.date === d && r.serviceGroupId === null)?.status;
    expect(general('2026-11-07')).toBe('exists');
    expect(general('2026-11-14')).toBe('exists');
    expect(general('2026-11-28')).toBe('create');
    expect(nov.existing.map((e) => e.id).sort()).toEqual([
      'moved',
      'nord',
      'same-time',
    ]);
  });

  it('two slots of one template on one day at one time still yield one meeting', async () => {
    const { planner } = build({
      slots: [GENERAL, slot({ id: 'twin', position: 1 })],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    expect(
      nov.rows.filter((r) => r.date === '2026-11-07').map((r) => r.status),
    ).toEqual(['create', 'exists']);
  });
});

describe('whose turn it is', () => {
  it('never led first, then longest ago; a man picked today is not asked again while others wait', async () => {
    const { planner } = build({
      slots: [GENERAL],
      meetings: [
        meeting({
          id: 'a',
          weekStartDate: '2026-09-28',
          conductorPublisherId: 'p-keller',
        }),
        meeting({
          id: 'b',
          weekStartDate: '2026-10-05',
          conductorPublisherId: 'p-hoffmann',
        }),
        meeting({
          id: 'c',
          weekStartDate: '2026-09-14',
          conductorPublisherId: 'p-schmidt',
        }),
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    expect(nov.rows.map(line)).toEqual([
      // Never led, in name order: Беккер, Фогт; then Шмидт (14 Sep),
      // Келлер (3 Oct); Хоффман (10 Oct) would be fifth.
      '2026-11-07 10:30 create p-becker',
      '2026-11-14 10:30 create p-vogt',
      '2026-11-21 10:30 create p-schmidt',
      '2026-11-28 10:30 create p-keller',
    ]);
    expect(nov.rows.map((r) => r.conductor?.reason)).toEqual([
      'never_led',
      'never_led',
      'last_led',
      'last_led',
    ]);
  });

  it('counts a draft as a turn taken, so the next month does not repeat it', async () => {
    const { planner } = build({
      slots: [GENERAL],
      meetings: [
        meeting({
          id: 'draft',
          conductorPublisherId: 'p-becker',
          publishedAt: null,
        }),
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    // Sat 7 already stands (the draft); 14, 21, 28 are new, and Беккер, who
    // has the draft of the 7th, is last in the queue — the never-led go in
    // name order: Келлер, Фогт, Шмидт.
    expect(nov.rows.map(line)).toEqual([
      '2026-11-07 10:30 exists -',
      '2026-11-14 10:30 create p-keller',
      '2026-11-21 10:30 create p-vogt',
      '2026-11-28 10:30 create p-hoffmann',
    ]);
  });

  it('away or already conducting that day: listed, with the reason, not picked', async () => {
    const { planner } = build({
      slots: [GENERAL],
      absences: [
        {
          publisherId: 'p-becker',
          startDate: '2026-11-01',
          endDate: '2026-11-15',
        },
      ],
      meetings: [
        // Келлер conducts the Nord group on the 7th at 09:00.
        meeting({
          id: 'nord',
          startTime: '09:00',
          address: 'Ahornstraße 12',
          serviceGroupId: G_NORD,
          conductorPublisherId: 'p-keller',
        }),
      ],
    });
    const list = await planner.suggestConductor(CONG, { date: '2026-11-07' });
    const by = Object.fromEntries(list.map((c) => [c.publisherId, c]));
    expect(by['p-becker']).toMatchObject({ reason: 'absent', free: false });
    expect(by['p-keller']).toMatchObject({
      reason: 'leads_that_day',
      free: false,
    });
    // The circle only: no sister, nobody inactive, nobody without the switch.
    expect(list.map((c) => c.publisherId)).not.toEqual(
      expect.arrayContaining(['p-sister', 'p-gone', 'p-nord-ov']),
    );
    // The free ones first.
    expect(list.findIndex((c) => !c.free)).toBe(
      list.filter((c) => c.free).length,
    );
    const nov = await planner.preview(CONG, 2026, 11);
    expect(nov.rows[0].conductor?.publisherId).not.toBe('p-becker');
    expect(nov.rows[0].conductor?.publisherId).not.toBe('p-keller');
  });

  it('a brother already down for a later day is free, but last — with that day named', async () => {
    const { planner } = build({
      meetings: [
        // Keller conducts on 21 November; asked about the 7th he is still free,
        // but the turn goes to the others first.
        meeting({
          id: 'later',
          weekStartDate: '2026-11-16',
          conductorPublisherId: 'p-keller',
        }),
        meeting({
          id: 'sooner',
          weekStartDate: '2026-11-09',
          conductorPublisherId: 'p-vogt',
        }),
      ],
    });
    const list = await planner.suggestConductor(CONG, { date: '2026-11-07' });
    const ids = list.filter((c) => c.free).map((c) => c.publisherId);
    // The two with bookings close the free part: the farther booking first,
    // the soonest last.
    expect(ids.slice(-2)).toEqual(['p-keller', 'p-vogt']);
    expect(list.find((c) => c.publisherId === 'p-vogt')).toMatchObject({
      reason: 'upcoming',
      lastDate: '2026-11-14',
      free: true,
    });
    // Within the month being prepared, the same booking is a turn taken.
    const nov = await planner.preview(CONG, 2026, 11);
    expect(nov.rows[0].conductor?.publisherId).not.toBe('p-keller');
  });

  it('the meeting being edited does not make its own conductor «busy»', async () => {
    const { planner } = build({
      meetings: [meeting({ id: 'm-7', conductorPublisherId: 'p-keller' })],
    });
    const list = await planner.suggestConductor(CONG, {
      date: '2026-11-07',
      excludeMeetingId: 'm-7',
    });
    expect(list.find((c) => c.publisherId === 'p-keller')?.free).toBe(true);
  });

  it('a group’s meeting: its overseer, else its assistant, even outside the circle', async () => {
    const { planner } = build({
      absences: [
        { publisherId: 'p-vogt', startDate: '2026-11-07', endDate: null },
      ],
    });
    const nov = await planner.preview(CONG, 2026, 11);
    const verne = nov.rows.filter((r) => r.serviceGroupId === G_VERNE);
    expect(verne.map(line)).toEqual([
      '2026-11-07 10:00 create p-schmidt',
      '2026-11-21 10:00 create p-vogt',
    ]);
    expect(verne[0].conductor?.reason).toBe('group_assistant');
    expect(verne[0].address).toBe('Lindenweg 5');
    // Nord's overseer has no switch: for HIS group he still conducts.
    const nord = await planner.suggestConductor(CONG, {
      date: '2026-11-07',
      serviceGroupId: G_NORD,
      conductorRule: 'group_overseer',
    });
    expect(nord[0]).toMatchObject({
      publisherId: 'p-nord-ov',
      reason: 'group_overseer',
      free: true,
    });
  });

  it('nobody free, nobody appointed, or the rule «none»: the row says why', async () => {
    const { planner } = build({
      slots: [
        GENERAL,
        slot({
          id: 's-none',
          position: 1,
          startTime: '15:00',
          address: 'Marktplatz',
          conductorRule: 'none',
        }),
        slot({
          id: 's-orphan',
          position: 2,
          startTime: '16:00',
          address: null,
          serviceGroupId: 'g-orphan',
          conductorRule: 'group_overseer',
        }),
      ],
      groups: [
        {
          id: 'g-orphan',
          name: 'Без надзирателя',
          overseerPublisherId: null,
          assistantPublisherId: null,
          meetingLocation: 'x',
        },
      ],
      absences: PEOPLE.map((p) => ({
        publisherId: p.id,
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      })),
    });
    const nov = await planner.preview(CONG, 2026, 11);
    const sat7 = nov.rows.filter((r) => r.date === '2026-11-07');
    expect(sat7.map((r) => r.noConductor)).toEqual([
      'nobody_free',
      'rule_none',
      'no_overseer',
    ]);
    expect(sat7.every((r) => r.status === 'create')).toBe(true);
  });

  it('pickConductors: false leaves every conductor empty', async () => {
    const { planner } = build({});
    const nov = await planner.preview(CONG, 2026, 11, false);
    expect(nov.rows.every((r) => r.conductor === null)).toBe(true);
  });
});

describe('prepare', () => {
  it('writes exactly the rows the preview said, as drafts, and journals the run once', async () => {
    const { planner, meetingRepo, audit } = build({
      events: [
        {
          type: 'regional_convention',
          title: 'Конгресс',
          date: '2026-11-20',
          endDate: '2026-11-22',
        },
      ],
      meetings: [
        meeting({
          id: 'nord',
          weekStartDate: '2026-11-09',
          startTime: '10:00',
          address: 'Ahornstraße 12',
          serviceGroupId: G_NORD,
        }),
      ],
    });
    const out = await planner.prepare(CONG, 2026, 11);
    expect(out).toEqual({
      created: 4,
      withoutConductor: 0,
      skipped: { exists: 0, assembly: 2, co_visit: 0, past: 0 },
    });
    const rows = meetingRepo.save.mock.calls[0][0] as Record<string, unknown>[];
    expect(
      rows.map((r) => `${r.weekStartDate}/${r.dayOfWeek} ${r.startTime}`),
    ).toEqual([
      '2026-11-02/6 10:00',
      '2026-11-02/6 10:30',
      '2026-11-09/6 10:30',
      '2026-11-23/6 10:30',
    ]);
    expect(rows.every((r) => r.publishedAt === null)).toBe(true);
    expect(rows[0]).toMatchObject({
      serviceGroupId: G_VERNE,
      isGeneral: false,
      address: 'Lindenweg 5',
      conductorPublisherId: 'p-vogt',
    });
    expect(rows[1]).toMatchObject({ serviceGroupId: null, isGeneral: true });
    expect(audit.logEvent).toHaveBeenCalledTimes(1);
    expect(audit.logEvent.mock.calls[0][0].detail).toMatchObject({
      bulk: true,
      draft: true,
      count: 4,
      skipped: { assembly: 2 },
    });
  });

  it('nothing to make: nothing written, nothing journalled', async () => {
    const { planner, meetingRepo, audit } = build({ slots: [] });
    const out = await planner.prepare(CONG, 2026, 11);
    expect(out.created).toBe(0);
    expect(meetingRepo.save).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });
});
