import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MapPhotoController } from './map-photo.controller';
import { MapPhotoService, type Fetcher } from './map-photo.service';
import { dopUrl, photoTile, tileBox } from './photo-tile';

// Hamm at zoom 16: x 34191, y 21712 (the tile holding 7.82 E, 51.68 N).
const HAMM = { z: '16', x: '34191', y: '21712' };
const lonOfTile = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

describe('photo tiles (R-67)', () => {
  it('a tile of Hamm is one; the arithmetic puts it at Hamm', () => {
    const t = photoTile(HAMM.z, HAMM.x, HAMM.y);
    expect(t).toEqual({ z: 16, x: 34191, y: 21712 });
    const lon = lonOfTile(34191, 16);
    expect(lon).toBeGreaterThan(7.8);
    expect(lon).toBeLessThan(7.83);
    const [minX, minY, maxX, maxY] = tileBox(t!);
    expect(maxX - minX).toBeCloseTo(611.5, 0);
    expect(maxY - minY).toBeCloseTo(611.5, 0);
  });

  it('nothing outside the Land, no silly zooms, no tricks in the numbers', () => {
    expect(photoTile('16', '32000', '24000')).toBeNull(); // far south-west of NRW
    expect(photoTile('16', '34191', '23500')).toBeNull(); // south of the Land
    expect(photoTile('11', '1068', '678')).toBeNull(); // below zoom 12
    expect(photoTile('20', '1094112', '694784')).toBeNull(); // above 19
    expect(photoTile('16', '65536', '21712')).toBeNull(); // past the world
    expect(photoTile('16', '1e4', '21712')).toBeNull();
    expect(photoTile('16', '-1', '21712')).toBeNull();
    expect(photoTile('16', '34191.5', '21712')).toBeNull();
  });

  it('asks the Land for exactly that square, 512 pixels, JPEG', () => {
    const url = dopUrl({ z: 16, x: 34191, y: 21712 });
    expect(url.startsWith('https://www.wms.nrw.de/geobasis/wms_nw_dop?')).toBe(
      true,
    );
    expect(url).toContain('LAYERS=nw_dop_rgb');
    expect(url).toContain('CRS=EPSG:3857');
    expect(url).toContain('WIDTH=512&HEIGHT=512&FORMAT=image/jpeg');
    const bbox = /BBOX=([^&]+)/.exec(url)![1].split(',').map(Number);
    expect(bbox).toEqual(
      tileBox({ z: 16, x: 34191, y: 21712 }).map((v) => Number(v.toFixed(3))),
    );
  });
});

const jpeg = (n = 3) => Buffer.from([0xff, 0xd8, 0xff, ...Array(n).fill(1)]);
const answer = (body: Buffer, type = 'image/jpeg', status = 200) =>
  new Response(new Uint8Array(body), {
    status,
    headers: { 'content-type': type },
  });

describe('MapPhotoService', () => {
  it('keeps a tile, and one asked twice at once is fetched once', async () => {
    const s = new MapPhotoService();
    let calls = 0;
    s.fetcher = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return answer(jpeg());
    }) as Fetcher;
    const t = { z: 16, x: 34191, y: 21712 };
    const [a, b] = await Promise.all([s.tile(t), s.tile(t)]);
    expect(a?.equals(jpeg())).toBe(true);
    expect(b?.equals(jpeg())).toBe(true);
    await s.tile(t);
    expect(calls).toBe(1);
  });

  it('what is not a JPEG, a failure or an empty body is no tile, and is not kept', async () => {
    const s = new MapPhotoService();
    const t = { z: 16, x: 34191, y: 21712 };
    s.fetcher = (async () =>
      answer(Buffer.from('<ServiceException/>'), 'text/xml')) as Fetcher;
    expect(await s.tile(t)).toBeNull();
    s.fetcher = (async () => answer(jpeg(), 'image/jpeg', 500)) as Fetcher;
    expect(await s.tile(t)).toBeNull();
    s.fetcher = (async () => answer(Buffer.alloc(0))) as Fetcher;
    expect(await s.tile(t)).toBeNull();
    s.fetcher = (async () => {
      throw new Error('timeout');
    }) as Fetcher;
    expect(await s.tile(t)).toBeNull();
    let calls = 0;
    s.fetcher = (async () => {
      calls++;
      return answer(jpeg());
    }) as Fetcher;
    expect(await s.tile(t)).not.toBeNull();
    expect(calls).toBe(1);
  });

  it('keeps no more than a few hundred tiles, dropping the oldest', async () => {
    const s = new MapPhotoService();
    let calls = 0;
    s.fetcher = (async () => {
      calls++;
      return answer(jpeg());
    }) as Fetcher;
    for (let i = 0; i < 401; i++)
      await s.tile({ z: 16, x: 34000 + i, y: 21712 });
    expect(calls).toBe(401);
    await s.tile({ z: 16, x: 34400, y: 21712 }); // the newest: kept
    expect(calls).toBe(401);
    await s.tile({ z: 16, x: 34000, y: 21712 }); // the oldest: gone
    expect(calls).toBe(402);
  });
});

describe('GET /map-photo/:z/:x/:y.jpg', () => {
  let app: INestApplication;
  let fetched: string[];
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [MapPhotoController],
      providers: [MapPhotoService],
    }).compile();
    app = mod.createNestApplication();
    const s = mod.get(MapPhotoService);
    fetched = [];
    s.fetcher = (async (url: string) => {
      fetched.push(url);
      return url === dopUrl({ z: 16, x: 34192, y: 21712 })
        ? answer(Buffer.from('<ServiceException/>'), 'text/xml')
        : answer(jpeg(10));
    }) as Fetcher;
    await app.init();
  });
  afterAll(() => app.close());

  it('gives the JPEG with a week of caching', async () => {
    const r = await request(app.getHttpServer()).get(
      '/map-photo/16/34191/21712.jpg',
    );
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toBe('public, max-age=604800');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(Buffer.from(r.body).equals(jpeg(10))).toBe(true);
  });

  it('a tile outside the Land is a plain 404 and the Land is never asked', async () => {
    const before = fetched.length;
    const r = await request(app.getHttpServer()).get(
      '/map-photo/16/32000/24000.jpg',
    );
    expect(r.status).toBe(404);
    expect(fetched.length).toBe(before);
  });

  it('when the Land answers nonsense: 502, not kept', async () => {
    const r = await request(app.getHttpServer()).get(
      '/map-photo/16/34192/21712.jpg',
    );
    expect(r.status).toBe(502);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('MapPhotoService — the Land kept from harm', () => {
  it('asks the Land at most 12 times at once, however many wait', async () => {
    const s = new MapPhotoService();
    let now = 0,
      most = 0;
    s.fetcher = (async () => {
      now++;
      most = Math.max(most, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      return answer(jpeg());
    }) as Fetcher;
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        s.tile({ z: 16, x: 34000 + i, y: 21712 }),
      ),
    );
    expect(most).toBe(12);
  });

  it('after five failures in a row it stops asking for a minute, then asks again', async () => {
    const s = new MapPhotoService();
    let clock = 1_000_000;
    s.now = () => clock;
    let calls = 0;
    s.fetcher = (async () => {
      calls++;
      return answer(Buffer.from('x'), 'text/xml');
    }) as Fetcher;
    for (let i = 0; i < 5; i++) await s.tile({ z: 16, x: 34000 + i, y: 21712 });
    expect(calls).toBe(5);
    expect(await s.tile({ z: 16, x: 34100, y: 21712 })).toBeNull();
    expect(calls).toBe(5);
    clock += 61_000;
    s.fetcher = (async () => {
      calls++;
      return answer(jpeg());
    }) as Fetcher;
    expect(await s.tile({ z: 16, x: 34101, y: 21712 })).not.toBeNull();
    expect(calls).toBe(6);
  });

  it('a body announced too large is not read', async () => {
    const s = new MapPhotoService();
    s.fetcher = (async () =>
      new Response(new Uint8Array(jpeg()), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' },
      })) as Fetcher;
    expect(await s.tile({ z: 16, x: 34191, y: 21712 })).toBeNull();
  });
});
