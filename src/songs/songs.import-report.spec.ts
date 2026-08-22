import { SongsService, parseSongList } from './songs.service';
import { Song } from '../entities/song.entity';
import { Repository } from 'typeorm';

/**
 * What a songbook import actually changed.
 *
 * It used to answer with four numbers — parsed, created, updated, unchanged —
 * and a number is something the reader has to take on trust. Worse, it never
 * mentioned what a new songbook DROPPED: the import only adds and updates, so
 * a song no longer in the book stayed, was counted as «unchanged», and nobody
 * was told. True of the row, misleading about the songbook.
 */
describe('SongsService.bulkImport — what changed', () => {
  const makeService = (existing: { number: number; title: string }[] = []) => {
    const store = new Map<number, Song>();
    for (const s of existing) {
      store.set(s.number, { ...s, isActive: true } as Song);
    }
    const repo = {
      findOne: jest.fn(
        async ({ where: { number } }: { where: { number: number } }) =>
          store.get(number) ?? null,
      ),
      create: jest.fn((data: Partial<Song>) => ({ ...data }) as Song),
      save: jest.fn(async (s: Song) => {
        store.set(s.number, s);
        return s;
      }),
      find: jest.fn(async () =>
        [...store.values()].filter((s) => s.isActive !== false),
      ),
    };
    return new SongsService(repo as unknown as Repository<Song>);
  };

  it('names the numbers that were added', async () => {
    const service = makeService([{ number: 1, title: 'Качества Иеговы' }]);

    const r = await service.bulkImport(
      'ПЕСНЯ 1\nКачества Иеговы\nПЕСНЯ 2\nТвоё имя — Иегова',
    );

    expect(r.addedNumbers).toEqual([2]);
  });

  it('says what a renamed song was called before', async () => {
    // «12 обновлено» is a number nobody can check; «было … стало …» is.
    const service = makeService([{ number: 35, title: 'Старое название' }]);

    const r = await service.bulkImport('ПЕСНЯ 35\nУдостоверяйтесь в том');

    expect(r.renamed).toEqual([
      { number: 35, from: 'Старое название', to: 'Удостоверяйтесь в том' },
    ]);
  });

  it('does not call an unchanged song renamed', async () => {
    const service = makeService([{ number: 35, title: 'То же самое' }]);

    const r = await service.bulkImport('ПЕСНЯ 35\nТо же самое');

    expect(r.renamed).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it('names the songs the new list never mentions', async () => {
    // The point of the whole change: a song dropped from the songbook used to
    // stay on quietly, and the screen reported nothing at all.
    const service = makeService([
      { number: 1, title: 'Осталась' },
      { number: 5, title: 'Убрана из песенника' },
    ]);

    const r = await service.bulkImport('ПЕСНЯ 1\nОсталась');

    expect(r.missingNumbers).toEqual([5]);
  });

  it('does NOT remove them — that is a decision, not arithmetic', async () => {
    // Naming a song as missing must not touch it: whether a congregation
    // stops using a song is for the brothers to say, not for an import.
    const service = makeService([
      { number: 1, title: 'Осталась' },
      { number: 5, title: 'Убрана из песенника' },
    ]);

    await service.bulkImport('ПЕСНЯ 1\nОсталась');

    // Still there, still active, still with its own title.
    const after = await service.bulkImport('ПЕСНЯ 5\nУбрана из песенника');
    expect(after.unchanged).toBe(1);
    expect(after.created).toBe(0);
  });

  it('reports nothing missing for an empty paste', async () => {
    // Otherwise pasting nothing would accuse the whole songbook of being gone.
    const service = makeService([{ number: 1, title: 'Осталась' }]);

    const r = await service.bulkImport('   ');

    expect(r.missingNumbers).toEqual([]);
  });
});

describe('parseSongList — the lines it could not read', () => {
  it('hands back the offending line, not just a count', () => {
    // A count is the same silence that hid a missing week of December for a
    // year: something was wrong and there was no way to see what.
    const out = parseSongList('ПЕСНЯ 35\nПЕСНЯ 36\nНазвание');

    expect(out.invalid).toBe(1);
    expect(out.invalidLines).toEqual(['ПЕСНЯ 35']);
  });

  it('keeps the list of offending lines short', () => {
    const many = Array.from({ length: 40 }, (_, i) => `ПЕСНЯ ${i + 1}`).join(
      '\n',
    );

    const out = parseSongList(many);

    expect(out.invalid).toBeGreaterThan(20);
    expect(out.invalidLines).toHaveLength(20);
  });

  it('still reads both layouts the publications use', () => {
    const twoLine = parseSongList('ПЕСНЯ 1\nКачества Иеговы');
    const inline = parseSongList('SONG 2 Your name is Jehovah');

    expect(twoLine.items).toEqual([{ number: 1, title: 'Качества Иеговы' }]);
    expect(inline.items).toEqual([
      { number: 2, title: 'Your name is Jehovah' },
    ]);
  });
});
