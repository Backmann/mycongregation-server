import { PublicTalksService } from './public-talks.service';
import { PublicTalk } from '../entities/public-talk.entity';
import { Repository } from 'typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * What an imported catalogue changed — and, above all, what it no longer has.
 *
 * The import only ever added and updated, so a talk dropped from a new
 * catalogue stayed active and unmentioned. That is the one question the
 * coordinator is actually asked: «какие речи больше не говорим». The count of
 * «unchanged» answered it wrongly and confidently.
 */
describe('PublicTalksService.bulkImport — the report', () => {
  const build = (existing: { number: number; title: string }[] = []) => {
    const store = new Map<number, PublicTalk>();
    for (const t of existing) {
      store.set(t.number, { ...t, isActive: true } as PublicTalk);
    }
    const logEvent = jest.fn();
    const repo = {
      findOne: jest.fn(
        async ({ where: { number } }: { where: { number: number } }) =>
          store.get(number) ?? null,
      ),
      find: jest.fn(async () =>
        [...store.values()].filter((t) => t.isActive !== false),
      ),
      create: jest.fn((d: Partial<PublicTalk>) => ({ ...d }) as PublicTalk),
      save: jest.fn(async (t: PublicTalk) => {
        store.set(t.number, t);
        return t;
      }),
    };
    const service = new PublicTalksService(
      repo as unknown as Repository<PublicTalk>,
      { find: jest.fn(async () => []) } as never,
      { logEvent, findForEntity: jest.fn() } as unknown as AuditLogService,
    );
    return { service, store, logEvent, repo };
  };

  it('names the talks that are no longer in the catalogue', async () => {
    const { service } = build([
      { number: 1, title: 'Осталась' },
      { number: 7, title: 'Снята из перечня' },
    ]);

    const r = await service.bulkImport('1. Осталась', 'c1', 'u1');

    expect(r.missing).toEqual([{ number: 7, title: 'Снята из перечня' }]);
  });

  it('does NOT retire them on its own', async () => {
    // A partial paste would otherwise strike out the whole catalogue in one
    // press — and «what we no longer give» must not be answered by accident.
    const { service, store } = build([
      { number: 1, title: 'Осталась' },
      { number: 7, title: 'Снята из перечня' },
    ]);

    await service.bulkImport('1. Осталась', 'c1', 'u1');

    expect(store.get(7)?.isActive).toBe(true);
  });

  it('reports nothing missing for a paste with no talks in it', async () => {
    const { service } = build([{ number: 1, title: 'Осталась' }]);

    const r = await service.bulkImport('какой-то текст', 'c1', 'u1');

    expect(r.missing).toEqual([]);
  });

  it('names what was added and what was renamed', async () => {
    const { service } = build([{ number: 1, title: 'Старое название' }]);

    const r = await service.bulkImport(
      '1. Новое название\n2. Совсем новая',
      'c1',
      'u1',
    );

    expect(r.renamed).toEqual([
      { number: 1, from: 'Старое название', to: 'Новое название' },
    ]);
    expect(r.added).toEqual([{ number: 2, title: 'Совсем новая' }]);
  });

  it('hands back the lines it could not read', async () => {
    const { service } = build();

    const r = await service.bulkImport('1 Без точки\n2. Хорошая', 'c1', 'u1');

    expect(r.invalidLines).toEqual(['1 Без точки']);
  });

  it('writes the import to the journal, so «кто и когда» has an answer', async () => {
    const { service, logEvent } = build();

    await service.bulkImport('1. Речь', 'c1', 'u1');

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'public_talk_catalog',
        actorUserId: 'u1',
        detail: expect.objectContaining({ created: 1 }),
      }),
    );
  });
});

describe('PublicTalksService.retireMissing', () => {
  const build = (existing: { number: number; isActive: boolean }[]) => {
    const store = new Map(
      existing.map((t) => [
        t.number,
        { number: t.number, title: 'x', isActive: t.isActive } as PublicTalk,
      ]),
    );
    const repo = {
      find: jest.fn(
        async ({ where }: { where: { number: { _value: number[] } } }) =>
          [...store.values()].filter((t) =>
            (where.number._value as number[]).includes(t.number),
          ),
      ),
      save: jest.fn(async (t: PublicTalk) => {
        store.set(t.number, t);
        return t;
      }),
    };
    const service = new PublicTalksService(
      repo as unknown as Repository<PublicTalk>,
      { find: jest.fn() } as never,
      {
        logEvent: jest.fn(),
        findForEntity: jest.fn(),
      } as unknown as AuditLogService,
    );
    return { service, store };
  };

  it('retires the numbers it is given', async () => {
    const { service, store } = build([
      { number: 1, isActive: true },
      { number: 7, isActive: true },
    ]);

    const r = await service.retireMissing('c1', [7], 'u1');

    expect(r.retired).toBe(1);
    expect(store.get(7)?.isActive).toBe(false);
    // And leaves everything else exactly as it was.
    expect(store.get(1)?.isActive).toBe(true);
  });

  it('counts a talk already retired as nothing to do', async () => {
    const { service } = build([{ number: 7, isActive: false }]);

    await expect(service.retireMissing('c1', [7], 'u1')).resolves.toEqual({
      retired: 0,
    });
  });

  it('does nothing at all for an empty list', async () => {
    const { service } = build([{ number: 1, isActive: true }]);

    await expect(service.retireMissing('c1', [], 'u1')).resolves.toEqual({
      retired: 0,
    });
  });
});
