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
const MS_CARD_USER = 'user-ms-card'; // a ministerial servant by his card only

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

function build(opts: { row?: Partial<Row> | null; keeper?: boolean } = {}) {
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
    findOne: jest.fn(async () => ({ publisherId: CHAIR_PUB })),
  };
  const duties = {
    findOne: jest.fn(async () =>
      opts.keeper === false ? null : { publisherId: KEEPER_PUB },
    ),
  };
  const publishers = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id === CHAIR_PUB) return { id: CHAIR_PUB, userId: CHAIR_USER };
      if (where.id === KEEPER_PUB)
        return { id: KEEPER_PUB, userId: KEEPER_USER };
      if ('appointment' in where) {
        return where.userId === MS_CARD_USER ? { id: 'pub-ms' } : null;
      }
      if (where.userId === KEEPER_USER) return { displayName: 'Фогт Маркус' };
      if (where.userId === CHAIR_USER) return { displayName: 'Шмидт Пауль' };
      return null;
    }),
  };
  const service = new ConductLiveService(
    live as never,
    assignments as never,
    publishers as never,
    duties as never,
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
  it('a publisher who is neither appointed nor running it is refused', async () => {
    const { service } = build({ row: {} });
    await expect(
      service.find(user(UserRole.PUBLISHER, 'user-pub'), WEEK, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a ministerial servant by his card watches, though his account is a publisher', async () => {
    const { service } = build({ row: {} });
    const v = await service.find(
      user(UserRole.PUBLISHER, MS_CARD_USER),
      WEEK,
      NOW,
    );
    expect(v?.controllerName).toBe('Фогт Маркус');
    expect(v?.mine).toBe(false);
  });

  it('an elder watches', async () => {
    const { service } = build({ row: {} });
    expect(await service.find(user(UserRole.ELDER), WEEK, NOW)).not.toBeNull();
  });

  it('no meeting running → null, not a refusal', async () => {
    const { service } = build({ row: null });
    expect(await service.find(user(UserRole.ELDER), WEEK, NOW)).toBeNull();
  });

  it('a row older than a day is no longer the meeting → null', async () => {
    const { service } = build({
      row: { updatedAt: new Date(NOW.getTime() - CONDUCT_LIVE_KEEP_MS - 1000) },
    });
    expect(await service.find(user(UserRole.ELDER), WEEK, NOW)).toBeNull();
  });

  it("the controller's asking is his sign of life", async () => {
    const { service, live } = build({ row: {} });
    const v = await service.find(
      user(UserRole.PUBLISHER, KEEPER_USER),
      WEEK,
      NOW,
    );
    expect(v?.mine).toBe(true);
    expect(live.update).toHaveBeenCalledWith(
      { id: 'live-1' },
      expect.objectContaining({ controllerSeenAt: NOW }),
    );
  });

  it("the chairman's asking is his, for the timekeeper to see", async () => {
    const { service, live } = build({ row: {} });
    const v = await service.find(user(UserRole.ELDER, CHAIR_USER), WEEK, NOW);
    expect(v?.chairmanSeenAt).toBe(NOW.toISOString());
    expect(live.update).toHaveBeenCalledWith(
      { id: 'live-1' },
      expect.objectContaining({ chairmanSeenAt: NOW }),
    );
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
      service.take(
        user(UserRole.PUBLISHER, MS_CARD_USER),
        WEEK,
        undefined,
        NOW,
      ),
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

describe('a day later it is gone', () => {
  it('deletes the rows older than a day', async () => {
    const { service, live } = build();
    expect(await service.deleteExpired(NOW)).toBe(2);
    expect(live.delete).toHaveBeenCalled();
  });
});
