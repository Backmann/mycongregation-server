import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemorialService } from './memorial.service';
import { MEMORIAL_DEFAULT_THEME, MEMORIAL_TEMPLATE } from './memorial-template';
import { clockStub } from '../common/testing/clock-stub';

/**
 * The Memorial programme.
 *
 * The two rules worth guarding are the ones a reader would not guess from the
 * code: a new Memorial is filled from LAST YEAR'S rather than from anything
 * written here, and it carries the labels and songs but never the people.
 * That is what keeps the theme and the song numbers out of the source — they
 * change when the yearly letter changes, and a release should not be the way
 * a congregation types a new title.
 */

const FUTURE = '2099-04-02';
const PAST = '2020-04-07';

function build(
  opts: {
    event?: any;
    items?: any[];
    earlier?: any[];
    itemsByEvent?: Record<string, any[]>;
  } = {},
) {
  const event = opts.event ?? {
    id: 'ev-now',
    congregationId: 'cong-1',
    type: 'memorial',
    date: FUTURE,
    endDate: null,
    time: '19:00',
    address: null,
    memorialTheme: null,
    memorialThemeUrl: null,
    memorialPublishedAt: null,
  };
  const itemsByEvent = opts.itemsByEvent ?? {};
  const saved: any[] = [];

  const repo: any = {
    find: jest.fn(async (o: any) => {
      const id = o?.where?.specialEventId;
      return itemsByEvent[id] ?? opts.items ?? [];
    }),
    findOne: jest.fn(async (o: any) => {
      const all = Object.values(itemsByEvent)
        .flat()
        .concat(opts.items ?? []);
      return all.find((r: any) => r.id === o?.where?.id) ?? null;
    }),
    count: jest.fn(async (o: any) => {
      const id = o?.where?.specialEventId;
      return (itemsByEvent[id] ?? opts.items ?? []).length;
    }),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => {
      const rows = Array.isArray(x) ? x : [x];
      saved.push(...rows);
      return Array.isArray(x) ? rows : { ...x, id: x.id ?? 'new-1' };
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    softDelete: jest.fn(async () => ({ affected: 1 })),
    restore: jest.fn(async () => ({ affected: 1 })),
  };
  const eventsRepo: any = {
    findOne: jest.fn(async (o: any) => {
      if (o?.where?.id === event.id) return event;
      return (
        (opts.earlier ?? []).find((e: any) => e.id === o?.where?.id) ?? null
      );
    }),
    find: jest.fn(async () => opts.earlier ?? []),
    save: jest.fn(async (x: any) => x),
  };
  const audit = {
    logEvent: jest.fn(),
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
  };
  const svc = new MemorialService(
    repo,
    eventsRepo,
    audit as never,
    clockStub(),
  );
  return { svc, repo, eventsRepo, audit, event, saved };
}

describe('MemorialService.prepare — the first one comes from the template', () => {
  it('lays out the nine parts in the order the evening happens', async () => {
    const { svc, saved } = build();

    await svc.prepare('cong-1', 'ev-now');

    expect(saved.map((r) => r.partKey)).toEqual(
      MEMORIAL_TEMPLATE.map((l) => l.partKey),
    );
    // The prayers fall INSIDE the talk and the announcements follow it. A
    // sheet in any other order describes a different evening.
    const keys = saved.map((r) => r.partKey);
    expect(keys.indexOf('prayer_bread')).toBeGreaterThan(keys.indexOf('talk'));
    expect(keys.indexOf('prayer_wine')).toBeGreaterThan(
      keys.indexOf('prayer_bread'),
    );
    expect(keys.indexOf('announcements')).toBeGreaterThan(
      keys.indexOf('prayer_wine'),
    );
  });

  it('sets the theme from the default when there is no earlier Memorial', async () => {
    const { svc, event } = build();
    await svc.prepare('cong-1', 'ev-now');
    expect(event.memorialTheme).toBe(MEMORIAL_DEFAULT_THEME);
  });

  it('does nothing to a Memorial that already has a programme', async () => {
    const { svc, repo } = build({ items: [{ id: 'x', section: 'programme' }] });
    await svc.prepare('cong-1', 'ev-now');
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('MemorialService.prepare — every one after comes from last year', () => {
  const earlier = [
    {
      id: 'ev-2026',
      congregationId: 'cong-1',
      type: 'memorial',
      date: '2026-04-01',
      memorialTheme: 'Тема прошлого года',
      memorialThemeUrl: 'https://example.org/theme',
    },
  ];
  const lastYear = [
    {
      id: 'a',
      section: 'programme',
      partKey: 'chairman',
      label: 'Председатель',
      sortOrder: 0,
      songNumber: null,
      note: null,
      publisherId: 'pub-1',
      personText: null,
    },
    {
      id: 'b',
      section: 'emblems',
      partKey: null,
      label: 'Левый ряд',
      sortOrder: 0,
      songNumber: null,
      note: null,
      publisherId: 'pub-2',
      personText: null,
    },
    {
      id: 'c',
      section: 'duty',
      partKey: null,
      label: 'Стоянка',
      sortOrder: 0,
      songNumber: null,
      note: 'светоотражающие жилетки',
      publisherId: 'pub-3',
      personText: null,
    },
  ];

  it('carries the labels a congregation invented for its own hall', async () => {
    const { svc, saved } = build({
      earlier,
      itemsByEvent: { 'ev-2026': lastYear },
    });

    await svc.prepare('cong-1', 'ev-now');

    expect(saved.map((r) => r.label)).toEqual([
      'Председатель',
      'Левый ряд',
      'Стоянка',
    ]);
  });

  it('carries the notes — «светоотражающие жилетки» is true every year', async () => {
    const { svc, saved } = build({
      earlier,
      itemsByEvent: { 'ev-2026': lastYear },
    });
    await svc.prepare('cong-1', 'ev-now');
    expect(saved.find((r) => r.label === 'Стоянка').note).toBe(
      'светоотражающие жилетки',
    );
  });

  it('carries NOBODY: who says the prayer is decided afresh', async () => {
    const { svc, saved } = build({
      earlier,
      itemsByEvent: { 'ev-2026': lastYear },
    });

    await svc.prepare('cong-1', 'ev-now');

    expect(saved.every((r) => r.publisherId === null)).toBe(true);
    expect(saved.every((r) => r.personText === null)).toBe(true);
  });

  it('carries the theme, so a new title is typed once and never again', async () => {
    // This is the whole reason the theme is not a constant in the source: it
    // changes with the yearly letter, and a release is not how a congregation
    // should have to change a line of text.
    const { svc, event } = build({
      earlier,
      itemsByEvent: { 'ev-2026': lastYear },
    });

    await svc.prepare('cong-1', 'ev-now');

    expect(event.memorialTheme).toBe('Тема прошлого года');
    expect(event.memorialThemeUrl).toBe('https://example.org/theme');
  });

  it('skips an earlier Memorial that has no programme of its own', async () => {
    const { svc, saved } = build({
      earlier: [
        { id: 'ev-empty', type: 'memorial', date: '2026-04-01' },
        ...earlier,
      ],
      itemsByEvent: { 'ev-2026': lastYear, 'ev-empty': [] },
    });

    await svc.prepare('cong-1', 'ev-now');

    expect(saved.map((r) => r.label)).toContain('Левый ряд');
  });
});

describe('MemorialService — a Memorial already past is a record', () => {
  const overEvent = {
    id: 'ev-old',
    congregationId: 'cong-1',
    type: 'memorial',
    date: PAST,
    endDate: null,
    memorialTheme: null,
    memorialThemeUrl: null,
    memorialPublishedAt: null,
  };

  it('refuses every way of changing it', async () => {
    for (const call of [
      (s: MemorialService) => s.prepare('cong-1', 'ev-old'),
      (s: MemorialService) =>
        s.addLine('cong-1', 'ev-old', { section: 'duty', label: 'Фойе' }),
      (s: MemorialService) => s.publish('cong-1', 'ev-old'),
      (s: MemorialService) => s.setTheme('cong-1', 'ev-old', 'x', null),
    ]) {
      const { svc } = build({ event: overEvent });
      await expect(call(svc)).rejects.toThrow(ConflictException);
    }
  });

  it('writes the refusal to the journal', async () => {
    const { svc, audit } = build({ event: overEvent });
    await expect(svc.publish('cong-1', 'ev-old')).rejects.toThrow();
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DENY',
        detail: expect.objectContaining({ reason: 'past_memorial_frozen' }),
      }),
    );
  });

  it('still reads it, and says plainly that it cannot be edited', async () => {
    const { svc } = build({ event: overEvent, items: [] });
    const sheet = await svc.sheet('cong-1', 'ev-old');
    expect(sheet.editable).toBe(false);
  });
});

describe('MemorialService.publish — nobody is told about a half-empty sheet', () => {
  it('marks the moment once and does not move it afterwards', async () => {
    const { svc, event, eventsRepo } = build();

    await svc.publish('cong-1', 'ev-now');
    const first = event.memorialPublishedAt;
    expect(first).toBeInstanceOf(Date);

    (eventsRepo.save as jest.Mock).mockClear();
    await svc.publish('cong-1', 'ev-now');
    expect(event.memorialPublishedAt).toBe(first);
    expect(eventsRepo.save).not.toHaveBeenCalled();
  });
});

describe('MemorialService.reorder', () => {
  const rows = [
    { id: 'r1', section: 'emblems', sortOrder: 0 },
    { id: 'r2', section: 'emblems', sortOrder: 1 },
    { id: 'r3', section: 'emblems', sortOrder: 2 },
  ];

  it('puts the lines in the order given', async () => {
    const { svc, repo } = build({ items: rows });
    await svc.reorder('cong-1', 'ev-now', 'emblems', ['r3', 'r1', 'r2']);
    expect(
      (repo.update as jest.Mock).mock.calls.map((c) => [c[0].id, c[1]]),
    ).toEqual([
      ['r3', { sortOrder: 0 }],
      ['r1', { sortOrder: 1 }],
      ['r2', { sortOrder: 2 }],
    ]);
  });

  it('keeps a line the caller left out instead of dropping it', async () => {
    const { svc, repo } = build({ items: rows });
    await svc.reorder('cong-1', 'ev-now', 'emblems', ['r3']);
    const ids = (repo.update as jest.Mock).mock.calls.map((c) => c[0].id);
    expect(ids).toEqual(['r3', 'r1', 'r2']);
  });

  it('refuses ids that belong to another Memorial', async () => {
    const { svc } = build({ items: rows });
    await expect(
      svc.reorder('cong-1', 'ev-now', 'emblems', ['r1', 'somebody-elses']),
    ).rejects.toThrow(NotFoundException);
  });
});
