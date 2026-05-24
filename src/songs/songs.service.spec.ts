import { Repository } from 'typeorm';
import { SongsService, parseSongList } from './songs.service';
import { Song } from '../entities/song.entity';

describe('parseSongList', () => {
  it('parses the two-line JW layout and skips the "ПЕСНИ" heading', () => {
    const text = [
      'ПЕСНИ',
      'ПЕСНЯ 35',
      'Удостоверяйтесь в том, что более важно',
      'ПЕСНЯ 129',
      'Мы будем стойкими',
    ].join('\n');
    const { items, invalid } = parseSongList(text);
    expect(invalid).toBe(0);
    expect(items).toEqual([
      { number: 35, title: 'Удостоверяйтесь в том, что более важно' },
      { number: 129, title: 'Мы будем стойкими' },
    ]);
  });

  it('tolerates blank lines between blocks and CRLF endings', () => {
    const text =
      'ПЕСНЯ 1\r\n\r\nКачества Иеговы\r\n\r\nПЕСНЯ 2\r\nТвоё имя — Иегова\r\n';
    const { items } = parseSongList(text);
    expect(items).toEqual([
      { number: 1, title: 'Качества Иеговы' },
      { number: 2, title: 'Твоё имя — Иегова' },
    ]);
  });

  it('accepts the inline form "ПЕСНЯ N Title"', () => {
    const { items } = parseSongList('ПЕСНЯ 36 «Береги своё сердце»');
    expect(items).toEqual([{ number: 36, title: '«Береги своё сердце»' }]);
  });

  it('counts a header with no following title as invalid', () => {
    const { items, invalid } = parseSongList(
      'ПЕСНЯ 10\nПЕСНЯ 11\nВалидное название',
    );
    // First header has another header as its "title" → invalid; second is valid.
    expect(invalid).toBe(1);
    expect(items).toEqual([{ number: 11, title: 'Валидное название' }]);
  });

  it('rejects out-of-range numbers', () => {
    const { items, invalid } = parseSongList(
      'ПЕСНЯ 0\nНоль\nПЕСНЯ 1000\nТысяча',
    );
    expect(items).toEqual([]);
    expect(invalid).toBe(2);
  });
});

describe('SongsService.bulkImport', () => {
  function makeService(initial: Array<Partial<Song>> = []) {
    const store = new Map<number, Song>();
    let seq = 1;
    for (const s of initial) {
      store.set(
        s.number as number,
        {
          id: `id-${seq++}`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...s,
        } as Song,
      );
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
    };
    const service = new SongsService(repo as unknown as Repository<Song>);
    return { service, store };
  }

  it('creates new songs', async () => {
    const { service, store } = makeService();
    const r = await service.bulkImport(
      'ПЕСНЯ 35\nНазвание A\nПЕСНЯ 36\nНазвание B',
    );
    expect(r).toMatchObject({
      parsed: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
    });
    expect(store.get(35)?.title).toBe('Название A');
  });

  it('updates changed titles and leaves identical ones unchanged', async () => {
    const { service } = makeService([
      { number: 35, title: 'Старое название' },
      { number: 36, title: 'Без изменений' },
    ]);
    const r = await service.bulkImport(
      'ПЕСНЯ 35\nНовое название\nПЕСНЯ 36\nБез изменений',
    );
    expect(r).toMatchObject({ updated: 1, unchanged: 1, created: 0 });
  });

  it('reactivates a previously deactivated song on re-import', async () => {
    const { service, store } = makeService([
      { number: 35, title: 'Название', isActive: false },
    ]);
    const r = await service.bulkImport('ПЕСНЯ 35\nНазвание');
    expect(r.updated).toBe(1);
    expect(store.get(35)?.isActive).toBe(true);
  });
});
