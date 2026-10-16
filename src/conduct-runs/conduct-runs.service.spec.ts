import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ConductRunsService,
  CONDUCT_RUN_KEEP_DAYS,
} from './conduct-runs.service';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * How a midweek meeting ran — kept seven days, for the chairman of that week
 * and the appointed brothers (Lionel, 14 and 15 October 2026).
 */
const TENANT = 'cong-1';
const WEEK = '2026-10-12'; // a Monday
const CHAIR_USER = 'user-chair';
const CHAIR_PUB = 'pub-chair';

const user = (role: UserRole, id = 'user-x') =>
  ({
    id,
    role,
    congregationId: TENANT,
    email: null,
    uiLanguage: 'ru',
  }) as never;

const dto = {
  weekStartDate: WEEK,
  segments: [
    {
      key: 'bible_reading',
      assignmentId: null,
      publisherIds: ['p1'],
      plannedSec: 240,
      actualSec: 252,
      counselSec: 60,
    },
  ],
  totalSec: 6300,
  plannedSec: 6300,
};

const KEEPER_USER = 'user-keeper';
const KEEPER_PUB = 'pub-keeper';
const MS_CARD_USER = 'user-ms-card'; // a ministerial servant by his card only

function build(
  opts: {
    chair?: string | null;
    keeper?: string | null;
    stored?: Record<string, unknown> | null;
  } = {},
) {
  const chair = opts.chair === undefined ? CHAIR_PUB : opts.chair;
  const runs = {
    findOne: jest.fn().mockResolvedValue(opts.stored ?? null),
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    save: jest.fn(async (x: Record<string, unknown>) => ({ id: 'r1', ...x })),
    delete: jest.fn().mockResolvedValue({ affected: 3 }),
  };
  const assignments = {
    findOne: jest.fn().mockResolvedValue(chair ? { publisherId: chair } : null),
  };
  const publishers = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      'appointment' in where
        ? where.userId === MS_CARD_USER
          ? { id: 'pub-ms' }
          : null
        : where.id === CHAIR_PUB
          ? { id: CHAIR_PUB, userId: CHAIR_USER }
          : where.id === KEEPER_PUB
            ? { id: KEEPER_PUB, userId: KEEPER_USER }
            : null,
    ),
  };
  const duties = {
    findOne: jest
      .fn()
      .mockResolvedValue(opts.keeper ? { publisherId: opts.keeper } : null),
  };
  return {
    service: new ConductRunsService(
      runs as never,
      assignments as never,
      publishers as never,
      duties as never,
    ),
    runs,
  };
}

describe('saving how the meeting ran', () => {
  it('the timekeeper of that week saves it too — his device ends the meeting', async () => {
    const { service, runs } = build({ keeper: KEEPER_PUB });
    await service.save(user(UserRole.PUBLISHER, KEEPER_USER), dto as never);
    expect(runs.save).toHaveBeenCalled();
  });

  it('a publisher who is neither chairman nor timekeeper is refused', async () => {
    const { service, runs } = build({ keeper: KEEPER_PUB });
    await expect(
      service.save(user(UserRole.PUBLISHER, 'user-other'), dto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('the chairman of that week saves it, stamped now', async () => {
    const { service, runs } = build();
    const now = new Date('2026-10-14T19:45:00Z');
    const saved = await service.save(
      user(UserRole.ELDER, CHAIR_USER),
      dto as never,
      now,
    );
    expect(runs.save).toHaveBeenCalled();
    expect(saved.savedAt).toEqual(now);
    expect(saved.weekStartDate).toBe(WEEK);
    expect(saved.segments[0]).toEqual(dto.segments[0]);
  });

  it('an admin may too', async () => {
    const { service, runs } = build({ chair: null });
    await service.save(user(UserRole.ADMIN), dto as never);
    expect(runs.save).toHaveBeenCalled();
  });

  it('another elder may not — he did not run the meeting', async () => {
    const { service, runs } = build();
    await expect(
      service.save(user(UserRole.ELDER), dto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(runs.save).not.toHaveBeenCalled();
  });

  it('nor anyone when no chairman is named', async () => {
    const { service } = build({ chair: null });
    await expect(
      service.save(user(UserRole.ELDER, CHAIR_USER), dto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a day that is not a Monday is refused', async () => {
    const { service } = build();
    await expect(
      service.save(user(UserRole.ADMIN), {
        ...dto,
        weekStartDate: '2026-10-14',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finishing again replaces the row and restarts the seven days', async () => {
    const old = {
      id: 'r1',
      congregationId: TENANT,
      weekStartDate: WEEK,
      savedAt: new Date('2026-10-14T19:00:00Z'),
      segments: [],
    };
    const { service, runs } = build({ stored: old });
    const now = new Date('2026-10-14T19:50:00Z');
    const saved = await service.save(
      user(UserRole.ELDER, CHAIR_USER),
      dto as never,
      now,
    );
    expect(runs.create).not.toHaveBeenCalled();
    expect(saved.id).toBe('r1');
    expect(saved.savedAt).toEqual(now);
  });
});

describe('reading how the meeting ran', () => {
  const savedAt = new Date('2026-10-14T19:45:00Z');
  const stored = { id: 'r1', weekStartDate: WEEK, savedAt, segments: [] };
  const day = 24 * 60 * 60 * 1000;

  it('the elders read it', async () => {
    const { service } = build({ stored });
    expect(
      await service.find(
        user(UserRole.ELDER),
        WEEK,
        new Date(savedAt.getTime() + day),
      ),
    ).toBe(stored);
  });

  it('the chairman reads it, even when he is no elder', async () => {
    const { service } = build({ stored });
    expect(
      await service.find(
        user(UserRole.MINISTERIAL_SERVANT, CHAIR_USER),
        WEEK,
        savedAt,
      ),
    ).toBe(stored);
  });

  it('a ministerial servant reads it — by his role', async () => {
    const { service } = build({ stored });
    expect(
      await service.find(user(UserRole.MINISTERIAL_SERVANT), WEEK, savedAt),
    ).toBe(stored);
  });

  it('… or by his card, though his account is a publisher', async () => {
    const { service } = build({ stored });
    expect(
      await service.find(user(UserRole.PUBLISHER, MS_CARD_USER), WEEK, savedAt),
    ).toBe(stored);
  });

  it('a publisher who is not appointed and did not chair may not', async () => {
    const { service } = build({ stored });
    await expect(
      service.find(user(UserRole.PUBLISHER), WEEK),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it(`after ${CONDUCT_RUN_KEEP_DAYS} days it is gone, even before the night's deletion`, async () => {
    const { service } = build({ stored });
    const keep = CONDUCT_RUN_KEEP_DAYS * day;
    expect(
      await service.find(
        user(UserRole.ADMIN),
        WEEK,
        new Date(savedAt.getTime() + keep),
      ),
    ).toBe(stored);
    expect(
      await service.find(
        user(UserRole.ADMIN),
        WEEK,
        new Date(savedAt.getTime() + keep + 1000),
      ),
    ).toBeNull();
  });

  it('no run is null, not an error', async () => {
    const { service } = build({ stored: null });
    expect(await service.find(user(UserRole.ELDER), WEEK)).toBeNull();
  });
});

describe('the nightly deletion', () => {
  it('deletes what is older than seven days', async () => {
    const { service, runs } = build();
    const now = new Date('2026-10-21T03:50:00Z');
    expect(await service.deleteExpired(now)).toBe(3);
    const arg = runs.delete.mock.calls[0][0] as { savedAt: { _value: Date } };
    expect(arg.savedAt._value).toEqual(new Date('2026-10-14T03:50:00Z'));
  });
});
