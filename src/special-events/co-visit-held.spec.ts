import {
  heldFromOps,
  HeldRow,
  ImportedPart,
  mendPlan,
  nothingHeld,
} from './co-visit-held';

/**
 * What a circuit visit holds in its week, and how a week an import spoiled is
 * put right. The story is in co-visit-held.ts; the rows below are the ones the
 * stand showed on 5 October after the January 2027 workbook was loaded twice.
 */
describe('what a circuit visit holds', () => {
  it('reads added rows and changed fields off the undo plan', () => {
    const held = heldFromOps([
      { op: 'deleted', id: 'study' },
      { op: 'added', id: 'talk' },
      { op: 'added', id: 'song' },
      { op: 'field', id: 'prayer', field: 'partTitle', prev: 'x' },
      { op: 'field', id: 'wt', field: 'partDurationMin', prev: 60 },
      { op: 'meeting', kind: 'midweek' },
    ]);
    expect([...held.added].sort()).toEqual(['song', 'talk']);
    expect([...(held.fields.get('prayer') ?? [])]).toEqual(['partTitle']);
    expect([...(held.fields.get('wt') ?? [])]).toEqual(['partDurationMin']);
    expect(held.fields.has('study')).toBe(false);
    expect([...held.hidden]).toEqual(['study']);
  });

  it('holds nothing for a visit that has no plan, or a broken one', () => {
    for (const ops of [null, undefined, 'x', [null, 5, { op: 'added' }]]) {
      const held = heldFromOps(ops);
      expect(held.added.size).toBe(0);
      expect(held.fields.size).toBe(0);
      expect(held.hidden.size).toBe(0);
    }
  });

  it('gathers several visits into one answer', () => {
    const held = nothingHeld();
    heldFromOps([{ op: 'added', id: 'a' }], held);
    heldFromOps([{ op: 'added', id: 'b' }], held);
    expect([...held.added].sort()).toEqual(['a', 'b']);
  });
});

describe('mending a visit week an import spoiled', () => {
  const parts: ImportedPart[] = [
    {
      partKey: 'mid_song',
      partTitle: 'Песня 64',
      partOrder: 9,
      durationMin: null,
    },
    {
      partKey: 'midweek_closing_prayer',
      partTitle: 'Заключительные слова | Песня 35 и молитва',
      partOrder: 15,
      durationMin: 3,
    },
  ];
  const held = () =>
    heldFromOps([
      { op: 'added', id: 'talk' },
      { op: 'added', id: 'song-of-visit' },
      { op: 'field', id: 'prayer', field: 'partTitle', prev: 'x' },
    ]);
  const spoiled = (): HeldRow[] => [
    {
      id: 'song-mid',
      partKey: 'mid_song',
      partTitle: 'Песня 64',
      partOrder: 9,
      partDurationMin: null,
    },
    {
      id: 'song-of-visit',
      partKey: 'mid_song',
      partTitle: 'Песня 64',
      partOrder: 9,
      partDurationMin: null,
    },
    {
      id: 'talk',
      partKey: 'co_service_talk',
      partTitle: null,
      partOrder: 13,
      partDurationMin: 30,
    },
    {
      id: 'prayer',
      partKey: 'midweek_closing_prayer',
      partTitle: 'Заключительные слова | Песня 35 и молитва',
      partOrder: 15,
      partDurationMin: 3,
    },
  ];

  it("empties the overseer's song row and puts it before the prayer", () => {
    expect(mendPlan(spoiled(), held(), parts, 30)).toContainEqual({
      id: 'song-of-visit',
      partTitle: null,
      partOrder: 14,
    });
  });

  it('takes the song off the closing prayer again', () => {
    expect(mendPlan(spoiled(), held(), parts, 30)).toContainEqual({
      id: 'prayer',
      partTitle: null,
    });
  });

  it("never touches the workbook's own song", () => {
    const ids = mendPlan(spoiled(), held(), parts, 30).map((m) => m.id);
    expect(ids).not.toContain('song-mid');
    expect(ids).not.toContain('talk');
  });

  it('finds nothing to mend in a week the visit left and nobody spoiled', () => {
    const rows = spoiled();
    rows[1] = { ...rows[1], partTitle: null, partOrder: 14 };
    rows[3] = { ...rows[3], partTitle: null };
    expect(mendPlan(rows, held(), parts, 30)).toEqual([]);
  });

  it('leaves a song somebody chose for the overseer', () => {
    const rows = spoiled();
    rows[1] = { ...rows[1], partTitle: 'Песня 151', partOrder: 14 };
    const ids = mendPlan(rows, held(), parts, 30).map((m) => m.id);
    expect(ids).not.toContain('song-of-visit');
  });

  it('leaves the same song chosen in its own place — only the title matches', () => {
    const rows = spoiled();
    rows[1] = { ...rows[1], partTitle: 'Песня 64', partOrder: 14 };
    const ids = mendPlan(rows, held(), parts, 30).map((m) => m.id);
    expect(ids).not.toContain('song-of-visit');
  });

  it('leaves a prayer title that is not the workbook one', () => {
    const rows = spoiled();
    rows[3] = { ...rows[3], partTitle: 'Молитва' };
    const ids = mendPlan(rows, held(), parts, 30).map((m) => m.id);
    expect(ids).not.toContain('prayer');
  });

  it('does nothing in a week no visit holds', () => {
    expect(mendPlan(spoiled(), nothingHeld(), parts, 30)).toEqual([]);
  });

  it('gives the weekend study its visit length back', () => {
    const wHeld = heldFromOps([
      { op: 'field', id: 'wt', field: 'partDurationMin', prev: 60 },
    ]);
    const rows: HeldRow[] = [
      {
        id: 'wt',
        partKey: 'watchtower_conductor',
        partTitle: 'Статья',
        partOrder: 6,
        partDurationMin: 60,
      },
    ];
    const wParts: ImportedPart[] = [
      {
        partKey: 'watchtower_conductor',
        partTitle: 'Статья',
        partOrder: 6,
        durationMin: 60,
      },
    ];
    expect(mendPlan(rows, wHeld, wParts, 30)).toEqual([
      { id: 'wt', partDurationMin: 30 },
    ]);
    rows[0].partDurationMin = 30;
    expect(mendPlan(rows, wHeld, wParts, 30)).toEqual([]);
  });
});
