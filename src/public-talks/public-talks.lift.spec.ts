import { PublicTalksService } from './public-talks.service';
import { PublicTalk } from '../entities/public-talk.entity';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * Lifting a restriction, and remembering every decision.
 *
 * A restriction is lifted the same way it was imposed — by a letter, about
 * particular numbers, on stated grounds. So it is its own act rather than «edit
 * the talk»: a year later the journal has to answer «почему вернули» as well as
 * «почему сняли».
 */
describe('PublicTalksService.liftRestriction', () => {
  const build = (
    talks: Array<{
      number: number;
      isActive: boolean;
      retiredFrom?: string | null;
    }>,
  ) => {
    const store = new Map(
      talks.map((t) => [
        t.number,
        {
          number: t.number,
          title: 'x',
          isActive: t.isActive,
          retiredFrom: t.retiredFrom ?? null,
          retiredUntil: null,
          retiredReason: 'Объявления, май 2026',
        } as PublicTalk,
      ]),
    );
    const logEvent = jest.fn();
    const repo = {
      find: jest.fn(async () => [...store.values()]),
      save: jest.fn(async (t: PublicTalk) => {
        store.set(t.number, t);
        return t;
      }),
    };
    const service = new PublicTalksService(
      repo as unknown as Repository<PublicTalk>,
      { find: jest.fn() } as never,
      { find: jest.fn(async () => []) } as never,
      { find: jest.fn(async () => []) } as never,
      { logEvent, findForEntity: jest.fn() } as unknown as AuditLogService,
    );
    return { service, store, logEvent };
  };

  it('gives the talk back and clears the restriction with it', async () => {
    // Left behind, the dates would make a talk active and forbidden at once —
    // a state nobody can act on.
    const { service, store } = build([
      { number: 92, isActive: false, retiredFrom: '2026-09-01' },
    ]);

    const out = await service.liftRestriction(
      'c1',
      [92],
      'u1',
      'Письмо филиала',
    );

    expect(out.lifted).toBe(1);
    expect(store.get(92)).toMatchObject({
      isActive: true,
      retiredFrom: null,
      retiredUntil: null,
      retiredReason: null,
    });
  });

  it('records the letter it was lifted on', async () => {
    const { service, logEvent } = build([
      { number: 92, isActive: false, retiredFrom: '2026-09-01' },
    ]);

    await service.liftRestriction('c1', [92], 'u1', 'Письмо филиала');

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RESTORE',
        detail: expect.objectContaining({
          reason: 'Письмо филиала',
          kind: 'lift',
        }),
      }),
    );
  });

  it('passes over a talk that was never restricted', async () => {
    const { service } = build([{ number: 1, isActive: true }]);

    await expect(service.liftRestriction('c1', [1], 'u1')).resolves.toEqual({
      lifted: 0,
    });
  });

  it('does nothing for an empty list', async () => {
    const { service, logEvent } = build([{ number: 1, isActive: true }]);

    await expect(service.liftRestriction('c1', [], 'u1')).resolves.toEqual({
      lifted: 0,
    });
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('PublicTalksService.catalogueHistory', () => {
  const build = (rows: unknown[]) => {
    const service = new PublicTalksService(
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      {
        findForEntity: jest.fn(async () => rows),
        logEvent: jest.fn(),
      } as unknown as AuditLogService,
    );
    return service;
  };

  it('tells a retirement, a lifting and an import apart', async () => {
    const service = build([
      {
        action: 'DELETE',
        createdAt: '2026-08-23T10:00:00Z',
        actorName: 'Бакманн Лионель',
        after: {
          retiredNumbers: [84, 85],
          retired: 2,
          from: '2026-09-01',
          reason: 'Объявления, май 2026',
        },
      },
      {
        action: 'RESTORE',
        createdAt: '2026-08-22T10:00:00Z',
        actorName: 'Бакманн Лионель',
        after: {
          liftedNumbers: [92],
          lifted: 1,
          kind: 'lift',
          reason: 'Письмо',
        },
      },
      {
        action: 'RESTORE',
        createdAt: '2026-08-21T10:00:00Z',
        actorName: null,
        after: { created: 190, parsed: 190 },
      },
    ]);

    const out = await service.catalogueHistory('c1');

    expect(out.map((e) => e.kind)).toEqual(['retire', 'lift', 'import']);
    expect(out[0]).toMatchObject({
      count: 2,
      from: '2026-09-01',
      reason: 'Объявления, май 2026',
    });
    expect(out[1]).toMatchObject({ count: 1, numbers: [92], reason: 'Письмо' });
  });

  it('answers with an empty list when nothing has ever been done', async () => {
    await expect(build([]).catalogueHistory('c1')).resolves.toEqual([]);
  });
});
