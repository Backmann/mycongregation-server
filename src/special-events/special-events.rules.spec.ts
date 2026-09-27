// The push SDK ships as ESM, which jest does not load; nothing here pushes.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { SpecialEventsService } from './special-events.service';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { SpecialEvent } from '../entities/special-event.entity';

/**
 * The rules an event now keeps (27 September).
 *
 *  - a visit that moves takes its programme with it;
 *  - an event that is over keeps its days and kind, and only an administrator
 *    removes one — without touching the programme of a week that was held;
 *  - an event cannot end before it starts, and a week has one visit;
 *  - where the circuit overseer stays is not sent to every member, and the
 *    bin is not shown to those who do not keep the events.
 *
 * Today is Sunday 27 September 2026 throughout.
 */
const TENANT = 'c1';
const TODAY = '2026-09-27';

const user = (role: UserRole, id = 'u1'): AuthenticatedUser =>
  ({ id, role, congregationId: TENANT }) as unknown as AuthenticatedUser;

function row(over: Partial<SpecialEvent>): SpecialEvent {
  return {
    id: 'e1',
    congregationId: TENANT,
    title: 'Посещение районного',
    type: 'circuit_overseer_visit',
    date: '2026-10-13',
    endDate: '2026-10-18',
    time: null,
    timeEnd: null,
    address: null,
    mapUrl: null,
    programUrl: null,
    note: null,
    coFirstName: 'Иван',
    coLastName: 'Тестов',
    coWifeName: null,
    coRole: 'overseer',
    coAccommodationAddress: 'Musterweg 1',
    coAccommodationPublisherId: 'p-host',
    coMidweekDow: 2,
    coRevertData: [{ op: 'added', id: 'a1' }],
    replacesMeeting: false,
    deletedAt: null,
    ...over,
  } as SpecialEvent;
}

function build(opts: {
  event?: SpecialEvent;
  others?: SpecialEvent[];
  responsibilities?: number;
}) {
  const event = opts.event ?? row({});
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([event]),
    getOne: jest.fn().mockResolvedValue(event),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    find: jest.fn().mockResolvedValue(opts.others ?? []),
    create: jest.fn((x) => ({ id: 'new', ...x })),
    save: jest.fn(async (x) => x),
    softDelete: jest.fn(),
    restore: jest.fn(),
  };
  const template = {
    apply: jest.fn(async (e) => e),
    revert: jest.fn(async (e) => {
      e.coRevertData = null;
    }),
    syncSpeaker: jest.fn(),
    displayName: jest.fn(() => 'Иван Тестов'),
    weekIsOver: jest.fn(
      async (e: { date: string }) => e.date < '2026-09-21', // this week runs
    ),
  };
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  };
  const clock = { todayFor: jest.fn().mockResolvedValue(TODAY) };
  const responsibilities = {
    count: jest.fn().mockResolvedValue(opts.responsibilities ?? 0),
  };
  const notices = { announce: jest.fn() };
  const svc = new SpecialEventsService(
    repo as never,
    template as never,
    audit as never,
    clock as never,
    responsibilities as never,
    notices as never,
  );
  return { svc, repo, qb, template, event, notices };
}

describe('a circuit visit that moves', () => {
  it('gives the old week back and lays the template on the new one', async () => {
    const { svc, template, event } = build({});
    await svc.update(TENANT, 'e1', {
      date: '2026-10-20',
      endDate: '2026-10-25',
    });
    expect(template.revert).toHaveBeenCalledTimes(1);
    expect(template.revert.mock.invocationCallOrder[0]).toBeLessThan(
      template.apply.mock.invocationCallOrder[0],
    );
    expect(template.apply).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-10-20' }),
    );
    expect(event.coRevertData).toBeNull();
  });

  it('leaves the programme alone when only the days inside the week change', async () => {
    const { svc, template } = build({});
    await svc.update(TENANT, 'e1', { endDate: '2026-10-17' });
    expect(template.revert).not.toHaveBeenCalled();
    expect(template.apply).not.toHaveBeenCalled();
    expect(template.syncSpeaker).toHaveBeenCalled();
  });

  it('takes the programme back when the event stops being a visit', async () => {
    const { svc, template } = build({});
    await svc.update(TENANT, 'e1', { type: 'other' });
    expect(template.revert).toHaveBeenCalledTimes(1);
  });

  it('lays the template when an event becomes a visit', async () => {
    const { svc, template } = build({
      event: row({ type: 'other', coRevertData: null }),
    });
    await svc.update(TENANT, 'e1', { type: 'circuit_overseer_visit' });
    expect(template.apply).toHaveBeenCalledTimes(1);
  });

  it('refuses a week that already has a visit', async () => {
    const { svc } = build({
      others: [row({ id: 'e2', date: '2026-10-21', endDate: null })],
    });
    await expect(
      svc.update(TENANT, 'e1', { date: '2026-10-20', endDate: '2026-10-25' }),
    ).rejects.toMatchObject({ response: { code: 'CO_VISIT_WEEK_TAKEN' } });
  });
});

describe('an event that is over', () => {
  const past = () =>
    row({ date: '2026-03-10', endDate: '2026-03-15', coRevertData: [] });

  it('keeps its days', async () => {
    const { svc } = build({ event: past() });
    await expect(
      svc.update(TENANT, 'e1', { date: '2026-03-17' }),
    ).rejects.toMatchObject({ response: { code: 'EVENT_PAST_LOCKED' } });
  });

  it('keeps its kind', async () => {
    const { svc } = build({ event: past() });
    await expect(
      svc.update(TENANT, 'e1', { type: 'other' }),
    ).rejects.toMatchObject({ response: { code: 'EVENT_PAST_LOCKED' } });
  });

  it('can have its note put right — without touching the programme', async () => {
    const { svc, template, repo } = build({ event: past() });
    await svc.update(TENANT, 'e1', { note: 'Был с супругой' });
    expect(repo.save).toHaveBeenCalled();
    expect(template.syncSpeaker).not.toHaveBeenCalled();
    expect(template.revert).not.toHaveBeenCalled();
  });

  it('is not removed by the body coordinator', async () => {
    const { svc } = build({ event: past(), responsibilities: 1 });
    await expect(
      svc.remove(TENANT, 'e1', user(UserRole.ELDER)),
    ).rejects.toMatchObject({ response: { code: 'EVENT_PAST_ADMIN_ONLY' } });
  });

  it('is removed by an administrator, and the programme stays as it was given', async () => {
    const { svc, template, repo } = build({ event: past() });
    await svc.remove(TENANT, 'e1', user(UserRole.ADMIN));
    expect(template.revert).not.toHaveBeenCalled();
    expect(repo.softDelete).toHaveBeenCalled();
  });

  it('a coming visit, removed, takes its programme with it', async () => {
    const { svc, template } = build({ responsibilities: 1 });
    await svc.remove(TENANT, 'e1', user(UserRole.ELDER));
    expect(template.revert).toHaveBeenCalledTimes(1);
  });

  it('nothing is moved into the past', async () => {
    const { svc } = build({
      event: row({ type: 'other', coRevertData: null }),
    });
    await expect(
      svc.update(TENANT, 'e1', { date: '2026-09-01', endDate: null }),
    ).rejects.toMatchObject({ response: { code: 'EVENT_MOVED_INTO_PAST' } });
  });
});

describe('dates', () => {
  it('an event cannot end before it starts', async () => {
    const { svc } = build({});
    await expect(
      svc.create(TENANT, {
        title: 'Конгресс',
        type: 'regional_convention',
        date: '2027-07-18',
        endDate: '2027-07-16',
      }),
    ).rejects.toMatchObject({ response: { code: 'EVENT_END_BEFORE_START' } });
  });

  it('the end day can be cleared', async () => {
    const { svc, repo } = build({
      event: row({ type: 'other', coRevertData: null }),
    });
    await svc.update(TENANT, 'e1', { endDate: null });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: null }),
    );
  });
});

describe('what leaves the server', () => {
  it('a publisher reads no accommodation and no undo plan', async () => {
    const { svc } = build({});
    const [e] = await svc.findAll(TENANT, {}, user(UserRole.PUBLISHER));
    expect(e.coAccommodationAddress).toBeNull();
    expect(e.coAccommodationPublisherId).toBeNull();
    expect('coRevertData' in e).toBe(false);
    // The rest of the visit — who comes, which day — everybody reads.
    expect(e.coFirstName).toBe('Иван');
    expect(e.coMidweekDow).toBe(2);
  });

  it('an elder reads where the overseer stays (he can open the visit schedule)', async () => {
    const { svc } = build({});
    const [e] = await svc.findAll(TENANT, {}, user(UserRole.ELDER));
    expect(e.coAccommodationAddress).toBe('Musterweg 1');
    expect('coRevertData' in e).toBe(false);
  });

  it('a publisher asking for the bin gets the list without it', async () => {
    const { svc, qb } = build({});
    await svc.findAll(
      TENANT,
      { includeRemoved: 'true', all: 'true' },
      user(UserRole.PUBLISHER),
    );
    expect(qb.withDeleted).not.toHaveBeenCalled();
  });

  it('the keeper of the events gets the bin', async () => {
    const { svc, qb } = build({ responsibilities: 1 });
    await svc.findAll(
      TENANT,
      { includeRemoved: 'true', all: 'true' },
      user(UserRole.ELDER),
    );
    expect(qb.withDeleted).toHaveBeenCalled();
  });

  it('a removed event is not opened by a publisher', async () => {
    const { svc } = build({ event: row({ deletedAt: new Date() }) });
    await expect(
      svc.findOneFor(TENANT, 'e1', user(UserRole.PUBLISHER)),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('telling the congregation', () => {
  it('a new event is announced', async () => {
    const { svc, notices } = build({});
    await svc.create(TENANT, {
      title: 'Конгресс',
      type: 'circuit_assembly',
      date: '2026-11-08',
    });
    expect(notices.announce).toHaveBeenCalledWith(expect.anything(), 'created');
  });

  it('a new hour is announced; a corrected note is not', async () => {
    const other = () =>
      row({ type: 'other', coRevertData: null, time: '09:00' });
    const a = build({ event: other() });
    await a.svc.update(TENANT, 'e1', { note: 'Перчатки' });
    expect(a.notices.announce).not.toHaveBeenCalled();
    const b = build({ event: other() });
    await b.svc.update(TENANT, 'e1', { time: '10:00' });
    expect(b.notices.announce).toHaveBeenCalledWith(
      expect.anything(),
      'changed',
    );
  });

  it('a coming event removed is announced as cancelled; one that is over, not', async () => {
    const a = build({ responsibilities: 1 });
    await a.svc.remove(TENANT, 'e1', user(UserRole.ELDER));
    expect(a.notices.announce).toHaveBeenCalledWith(
      expect.anything(),
      'cancelled',
    );
    const b = build({
      event: row({ date: '2026-03-10', endDate: null, coRevertData: [] }),
    });
    await b.svc.remove(TENANT, 'e1', user(UserRole.ADMIN));
    expect(b.notices.announce).not.toHaveBeenCalled();
  });

  it('an event brought back from the bin is announced as on again', async () => {
    const { svc, notices } = build({ event: row({ deletedAt: new Date() }) });
    await svc.restore(TENANT, 'e1');
    expect(notices.announce).toHaveBeenCalledWith(
      expect.anything(),
      'restored',
    );
  });
});
