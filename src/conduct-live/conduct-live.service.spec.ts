import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ConductLiveService,
  CONDUCT_LIVE_KEEP_MS,
} from './conduct-live.service';
import { UserRole } from '../common/enums/user-role.enum';
import { EventType } from '../common/enums/event-type.enum';

/**
 * A midweek meeting while it runs: run by one hand at a time — chairman,
 * timekeeper or admin — and watched by the appointed brothers (Lionel,
 * 15 October 2026).
 */
const TENANT = 'cong-1';
const WEEK = '2026-10-19'; // a Monday
const CHAIR_USER = 'user-chair';
const CHAIR_PUB = 'pub-chair';
const KEEPER_USER = 'user-keeper';
const KEEPER_PUB = 'pub-keeper';
const ADVISER_USER = 'user-adviser'; // the brother who gives counsel
const LMO_USER = 'user-lmo'; // the Life and Ministry overseer
const WT_USER = 'user-wt'; // the Watchtower study conductor
const WEEKEND_CHAIR_USER = 'user-weekend-chair';
const ELDER_USER = 'user-elder'; // an elder with no task in this meeting
const SERVANT_USER = 'user-servant'; // a ministerial servant
const WEEKEND_CHAIR_PUB = 'pub-weekend-chair';

const user = (role: UserRole, id = 'user-x') =>
  ({
    id,
    role,
    congregationId: TENANT,
    email: null,
    uiLanguage: 'ru',
  }) as never;

const NOW = new Date('2026-10-21T17:40:00Z');
const STATE = { index: 3, startedAt: NOW.getTime() - 60_000 };

type Row = Record<string, unknown> & {
  id: string;
  epoch: number;
  controllerUserId: string;
  updatedAt: Date;
};

function build(
  opts: { row?: Partial<Row> | null; keeper?: boolean; over?: boolean } = {},
) {
  let row: Row | null = opts.row
    ? ({
        id: 'live-1',
        congregationId: TENANT,
        weekStartDate: WEEK,
        eventType: 'midweek',
        state: STATE,
        epoch: 1,
        controllerUserId: KEEPER_USER,
        controllerSeenAt: NOW,
        chairmanSeenAt: null,
        updatedAt: NOW,
        ...opts.row,
      } as Row)
    : null;
  const live = {
    findOne: jest.fn(async () => (row ? { ...row } : null)),
    create: jest.fn((x: Record<string, unknown>) => ({ ...x })),
    save: jest.fn(async (x: Record<string, unknown>) => {
      row = { id: 'live-1', updatedAt: NOW, ...x } as Row;
      return { ...row };
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 2 })),
  };
  const assignments = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.partKey === 'weekend_chairman'
        ? { publisherId: WEEKEND_CHAIR_PUB }
        : { publisherId: CHAIR_PUB },
    ),
  };
  const duties = {
    findOne: jest.fn(async () =>
      opts.keeper === false ? null : { publisherId: KEEPER_PUB },
    ),
  };
  const publishers = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id === CHAIR_PUB) return { id: CHAIR_PUB, userId: CHAIR_USER };
      if (where.id === WEEKEND_CHAIR_PUB)
        return { id: WEEKEND_CHAIR_PUB, userId: WEEKEND_CHAIR_USER };
      if (where.id === KEEPER_PUB)
        return { id: KEEPER_PUB, userId: KEEPER_USER };
      if (where.userId === KEEPER_USER) return { displayName: 'Фогт Маркус' };
      if (where.userId === CHAIR_USER) return { displayName: 'Шмидт Пауль' };
      if (where.userId === ELDER_USER)
        return { displayName: 'Келлер Давид', appointment: 'elder' };
      if (where.userId === SERVANT_USER)
        return { displayName: 'Ланг Тимо', appointment: 'ministerial_servant' };
      return null;
    }),
    // Responsibilities: who oversees how the meeting runs.
    manager: {
      count: jest.fn(
        async (
          _e: unknown,
          { where }: { where: { userId: string; type: { _value: string[] } } },
        ) => {
          const held: Record<string, string> = {
            [ADVISER_USER]: 'adviser',
            [LMO_USER]: 'life_ministry_overseer',
            [WT_USER]: 'wt_study_conductor',
          };
          const t = held[where.userId];
          return t && where.type._value.includes(t) ? 1 : 0;
        },
      ),
    },
  };
  const service = new ConductLiveService(
    live as never,
    assignments as never,
    publishers as never,
    duties as never,
    { isOver: jest.fn(async () => opts.over === true) } as never,
  );
  return {
    service,
    live,
    get row() {
      return row;
    },
  };
}

describe('who may watch the meeting as it runs', () => {
  it('a publisher who neither runs it nor oversees it is refused', async () => {
    const { service } = build({ row: {} });
    await expect(
      service.find(user(UserRole.PUBLISHER, 'user-pub'), WEEK, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the counsel brother watches (16 October 2026)', async () => {
    const { service } = build({ row: {} });
    const { live: v, roles } = await service.find(
      user(UserRole.ELDER, ADVISER_USER),
      WEEK,
      NOW,
    );
    expect(roles).toMatchObject({ mayRun: false, hasTimekeeper: true });
    expect(v?.controllerName).toBe('Фогт Маркус');
    expect(v?.mine).toBe(false);
  });

  it('the Life and Ministry overseer watches, and an admin', async () => {
    const { service } = build({ row: {} });
    expect(
      (await service.find(user(UserRole.ELDER, LMO_USER), WEEK, NOW)).live,
    ).not.toBeNull();
    expect(
      (await service.find(user(UserRole.ADMIN), WEEK, NOW)).live,
    ).not.toBeNull();
  });

  it('a ministerial servant without those responsibilities is refused (an elder watches since 18 October 2026)', async () => {
    const { service } = build({ row: {} });
    expect(
      (await service.find(user(UserRole.ELDER, 'user-elder'), WEEK, NOW)).live,
    ).not.toBeNull();
    await expect(
      service.find(user(UserRole.MINISTERIAL_SERVANT, 'user-ms'), WEEK, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no meeting running → null, not a refusal', async () => {
    const { service } = build({ row: null });
    expect(
      (await service.find(user(UserRole.ADMIN), WEEK, NOW)).live,
    ).toBeNull();
  });

  it('a row older than a day is no longer the meeting → null', async () => {
    const { service } = build({
      row: { updatedAt: new Date(NOW.getTime() - CONDUCT_LIVE_KEEP_MS - 1000) },
    });
    expect(
      (await service.find(user(UserRole.ADMIN), WEEK, NOW)).live,
    ).toBeNull();
  });

  it("the controller's asking is his sign of life", async () => {
    const { service, live } = build({ row: {} });
    const { live: v, roles } = await service.find(
      user(UserRole.PUBLISHER, KEEPER_USER),
      WEEK,
      NOW,
    );
    expect(v?.mine).toBe(true);
    expect(roles).toMatchObject({
      mayRun: true,
      isTimekeeper: true,
      isChairman: false,
      timekeeperName: 'Фогт Маркус',
    });
    expect(live.update).toHaveBeenCalledWith(
      { id: 'live-1' },
      expect.objectContaining({ controllerSeenAt: NOW }),
    );
  });

  it("the chairman's asking is his, for the timekeeper to see", async () => {
    const { service, live } = build({ row: {} });
    const { live: v, roles } = await service.find(
      user(UserRole.ELDER, CHAIR_USER),
      WEEK,
      NOW,
    );
    expect(roles.isChairman).toBe(true);
    expect(v?.chairmanSeenAt).toBe(NOW.toISOString());
    expect(live.update).toHaveBeenCalledWith(
      { id: 'live-1' },
      expect.objectContaining({ chairmanSeenAt: NOW }),
    );
  });
});

it('without a timekeeper named, the chairman learns he runs it himself', async () => {
  const { service } = build({ row: null, keeper: false });
  const { roles } = await service.find(
    user(UserRole.ELDER, CHAIR_USER),
    WEEK,
    NOW,
  );
  expect(roles).toMatchObject({
    mayRun: true,
    isChairman: true,
    hasTimekeeper: false,
    timekeeperName: null,
  });
});

describe('running it — one hand at a time', () => {
  it('the first to start becomes the controller, epoch 1', async () => {
    const { service, live } = build({ row: null });
    const v = await service.write(
      user(UserRole.ELDER, CHAIR_USER),
      WEEK,
      0,
      STATE,
      NOW,
    );
    expect(v.mine).toBe(true);
    expect(v.epoch).toBe(1);
    expect(live.save).toHaveBeenCalled();
  });

  it('the timekeeper, a publisher by role, may start it', async () => {
    const { service } = build({ row: null });
    const v = await service.write(
      user(UserRole.PUBLISHER, KEEPER_USER),
      WEEK,
      0,
      STATE,
      NOW,
    );
    expect(v.controllerUserId).toBe(KEEPER_USER);
  });

  it('a brother who is not chairman, timekeeper or admin may not write', async () => {
    const { service, live } = build({ row: null });
    await expect(
      service.write(user(UserRole.ELDER, 'user-elder'), WEEK, 0, STATE, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(live.save).not.toHaveBeenCalled();
  });

  it('without a timekeeper named, only chairman and admin run it', async () => {
    const { service } = build({ row: null, keeper: false });
    await expect(
      service.write(user(UserRole.PUBLISHER, KEEPER_USER), WEEK, 0, STATE, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the controller with the current epoch is heard', async () => {
    const { service, live } = build({
      row: { controllerUserId: KEEPER_USER, epoch: 2 },
    });
    const next = { ...STATE, index: 4 };
    const v = await service.write(
      user(UserRole.PUBLISHER, KEEPER_USER),
      WEEK,
      2,
      next,
      NOW,
    );
    expect(v.state).toEqual(next);
    expect(live.save).toHaveBeenCalled();
  });

  it('somebody else writing while the timekeeper runs it is told who does', async () => {
    const { service, live } = build({ row: { controllerUserId: KEEPER_USER } });
    const err = await service
      .write(user(UserRole.ELDER, CHAIR_USER), WEEK, 1, STATE, NOW)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'CONDUCT_LIVE_NOT_YOURS',
      controllerName: 'Фогт Маркус',
    });
    expect(live.save).not.toHaveBeenCalled();
  });

  it('THE CASE IT EXISTS FOR: the chairman takes over, the timekeeper comes back online with old taps — refused', async () => {
    const b = build({ row: { controllerUserId: KEEPER_USER, epoch: 1 } });
    const taken = await b.service.take(
      user(UserRole.ELDER, CHAIR_USER),
      WEEK,
      undefined,
      NOW,
    );
    expect(taken.epoch).toBe(2);
    expect(taken.controllerUserId).toBe(CHAIR_USER);
    expect(taken.state).toEqual(STATE); // goes on from where the server had it
    b.live.save.mockClear();
    await expect(
      b.service.write(
        user(UserRole.PUBLISHER, KEEPER_USER),
        WEEK,
        1,
        { index: 9 },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(b.live.save).not.toHaveBeenCalled();
    expect(b.row?.state).toEqual(STATE);
  });

  it('the timekeeper may take it back the same way', async () => {
    const b = build({ row: { controllerUserId: CHAIR_USER, epoch: 2 } });
    const v = await b.service.take(
      user(UserRole.PUBLISHER, KEEPER_USER),
      WEEK,
      undefined,
      NOW,
    );
    expect(v.epoch).toBe(3);
    expect(v.mine).toBe(true);
  });

  it('a watcher may not take it over', async () => {
    const { service } = build({ row: {} });
    await expect(
      service.take(user(UserRole.ELDER, ADVISER_USER), WEEK, undefined, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a state that is not an object, or too large, is refused', async () => {
    const { service } = build({ row: null });
    await expect(
      service.write(user(UserRole.ADMIN), WEEK, 0, [1, 2], NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.write(
        user(UserRole.ADMIN),
        WEEK,
        0,
        { big: 'x'.repeat(40_000) },
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a week that is not a Monday is refused', async () => {
    const { service } = build({ row: null });
    await expect(
      service.write(user(UserRole.ADMIN), '2026-10-21', 0, STATE, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("after the meeting's day (16 October 2026)", () => {
  it('nothing is shown as running — a row left behind is not the meeting', async () => {
    const { service, live } = build({ row: {}, over: true });
    const { live: v, roles } = await service.find(
      user(UserRole.ELDER, CHAIR_USER),
      WEEK,
      NOW,
    );
    expect(v).toBeNull();
    expect(roles.isChairman).toBe(true);
    expect(live.update).not.toHaveBeenCalled();
  });

  it('a tap is refused, even from the controller with the right epoch', async () => {
    const { service, live } = build({
      row: { controllerUserId: KEEPER_USER, epoch: 1 },
      over: true,
    });
    const err = await service
      .write(user(UserRole.PUBLISHER, KEEPER_USER), WEEK, 1, STATE, NOW)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'CONDUCT_MEETING_OVER',
    });
    expect(live.save).not.toHaveBeenCalled();
  });

  it('… and so is a take-over, and a first start', async () => {
    const a = build({ row: {}, over: true });
    await expect(
      a.service.take(user(UserRole.ELDER, CHAIR_USER), WEEK, undefined, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    const b = build({ row: null, over: true });
    await expect(
      b.service.write(user(UserRole.ELDER, CHAIR_USER), WEEK, 0, STATE, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(b.live.save).not.toHaveBeenCalled();
  });
});

describe('a day later it is gone', () => {
  it('deletes the rows older than a day', async () => {
    const { service, live } = build();
    expect(await service.deleteExpired(NOW)).toBe(2);
    expect(live.delete).toHaveBeenCalled();
  });
});

describe('the weekend meeting (18 October 2026)', () => {
  // A ministerial servant's account here: an elder watches every meeting
  // (18 October 2026), and these are about the roles of the meeting itself.
  it('its chairman is the weekend chairman, not the midweek one', async () => {
    const { service } = build({ row: {} });
    const weekend = await service.find(
      user(UserRole.MINISTERIAL_SERVANT, WEEKEND_CHAIR_USER),
      WEEK,
      NOW,
      'weekend' as never,
    );
    expect(weekend.roles).toMatchObject({ isChairman: true, mayRun: true });
    await expect(
      service.find(
        user(UserRole.MINISTERIAL_SERVANT, WEEKEND_CHAIR_USER),
        WEEK,
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the Watchtower conductor watches it, the Life and Ministry overseer does not', async () => {
    const { service } = build({ row: {} });
    expect(
      (
        await service.find(
          user(UserRole.MINISTERIAL_SERVANT, WT_USER),
          WEEK,
          NOW,
          'weekend' as never,
        )
      ).live,
    ).not.toBeNull();
    await expect(
      service.find(
        user(UserRole.MINISTERIAL_SERVANT, LMO_USER),
        WEEK,
        NOW,
        'weekend' as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // …and the other way round on the midweek meeting.
    await expect(
      service.find(user(UserRole.MINISTERIAL_SERVANT, WT_USER), WEEK, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the counsel brother watches both', async () => {
    const { service } = build({ row: {} });
    expect(
      (
        await service.find(
          user(UserRole.MINISTERIAL_SERVANT, ADVISER_USER),
          WEEK,
          NOW,
          'weekend' as never,
        )
      ).live,
    ).not.toBeNull();
  });

  it('a row is written for the weekend meeting, in the main room', async () => {
    const { service, live } = build({ row: null });
    await service.write(
      user(UserRole.ADMIN),
      WEEK,
      0,
      STATE,
      NOW,
      'weekend' as never,
    );
    expect(live.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ eventType: 'weekend', room: 'main' }),
    });
    expect(live.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'weekend', room: 'main' }),
    );
  });
});

/**
 * 18 October 2026: the timekeeper ran the weekend meeting on his iPad, then
 * opened it on his phone too. Both devices were «his», both were heard, and
 * the phone sent its own old run over the iPad's. Now one device of the
 * account taps; the other watches until «Взять ведение».
 */
describe('one device of the account taps', () => {
  const IPAD = 'device-ipad-0001';
  const PHONE = 'device-phone-0001';
  const keeper = () => user(UserRole.PUBLISHER, KEEPER_USER);

  it('the first write binds the row to the device that made it', async () => {
    const b = build({ row: null });
    const v = await b.service.write(
      keeper(),
      WEEK,
      0,
      STATE,
      NOW,
      EventType.MIDWEEK,
      IPAD,
    );
    expect(b.row?.controllerDeviceId).toBe(IPAD);
    expect(v.mine).toBe(true);
    expect(v.mineElsewhere).toBe(false);
  });

  it('the same account on another device watches: not mine, mine elsewhere', async () => {
    const b = build({ row: { controllerDeviceId: IPAD } });
    const { live } = await b.service.find(
      keeper(),
      WEEK,
      NOW,
      EventType.MIDWEEK,
      PHONE,
    );
    expect(live?.mine).toBe(false);
    expect(live?.mineElsewhere).toBe(true);
    // …and its asking is no sign of life of the iPad.
    expect(b.live.update).not.toHaveBeenCalled();
  });

  it('the device that taps is still the controller, and its asking is its sign of life', async () => {
    const b = build({ row: { controllerDeviceId: IPAD } });
    const { live } = await b.service.find(
      keeper(),
      WEEK,
      NOW,
      EventType.MIDWEEK,
      IPAD,
    );
    expect(live?.mine).toBe(true);
    expect(b.live.update).toHaveBeenCalled();
  });

  it('a write from the other device is refused, the run on the server stays', async () => {
    const b = build({ row: { controllerDeviceId: IPAD } });
    await expect(
      b.service.write(
        keeper(),
        WEEK,
        1,
        { index: 1 },
        NOW,
        EventType.MIDWEEK,
        PHONE,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(b.row?.state).toEqual(STATE);
  });

  it('«Взять ведение» on the phone moves the taps to it; the iPad is refused after', async () => {
    const b = build({ row: { controllerDeviceId: IPAD, epoch: 1 } });
    const v = await b.service.take(
      keeper(),
      WEEK,
      undefined,
      NOW,
      EventType.MIDWEEK,
      PHONE,
    );
    expect(v.mine).toBe(true);
    expect(v.epoch).toBe(2);
    expect(b.row?.controllerDeviceId).toBe(PHONE);
    await expect(
      b.service.write(
        keeper(),
        WEEK,
        2,
        { index: 9 },
        NOW,
        EventType.MIDWEEK,
        IPAD,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a row from an app before devices is heard from any device and bound to the first that names itself', async () => {
    const b = build({ row: { controllerDeviceId: null } });
    const v = await b.service.write(
      keeper(),
      WEEK,
      1,
      { index: 4 },
      NOW,
      EventType.MIDWEEK,
      PHONE,
    );
    expect(v.mine).toBe(true);
    expect(b.row?.controllerDeviceId).toBe(PHONE);
  });

  it('an app that names no device is heard as before', async () => {
    const b = build({ row: { controllerDeviceId: IPAD } });
    const v = await b.service.write(
      keeper(),
      WEEK,
      1,
      { index: 4 },
      NOW,
      EventType.MIDWEEK,
      null,
    );
    expect(v.mine).toBe(true);
    expect(b.row?.controllerDeviceId).toBe(IPAD);
  });
});

/** Lionel, 18 October 2026: every elder may see that the meeting runs. */
describe('the elders watch the meeting as it runs', () => {
  it('an elder with no task in it watches', async () => {
    const { service } = build({ row: {} });
    const { live, roles } = await service.find(
      user(UserRole.PUBLISHER, ELDER_USER),
      WEEK,
      NOW,
    );
    expect(live?.mine).toBe(false);
    expect(roles.mayRun).toBe(false);
  });

  it('a ministerial servant with no task in it does not', async () => {
    const { service } = build({ row: {} });
    await expect(
      service.find(user(UserRole.PUBLISHER, SERVANT_USER), WEEK, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('watching is all: an elder cannot write or take over', async () => {
    const { service } = build({ row: {} });
    const elder = user(UserRole.PUBLISHER, ELDER_USER);
    await expect(
      service.write(elder, WEEK, 1, STATE, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.take(elder, WEEK, undefined, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
