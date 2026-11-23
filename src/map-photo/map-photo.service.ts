import { Injectable, Logger } from '@nestjs/common';
import { dopUrl, type Tile } from './photo-tile';

/** How many tiles are kept in memory: a territory at street level, several times over. */
const KEEP = 400;
/** A tile larger than this is not a tile. */
const MAX_BYTES = 1_500_000;
/** The Land's server answers in well under a second; past this the pair is better off without. */
const TIMEOUT_MS = 8000;

export type Fetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

/**
 * The photograph through our own server (R-67): the Land's server sees the
 * congregation's server, never a publisher's phone. A few hundred tiles are
 * kept, the same tile asked twice at once is fetched once, and whatever the
 * Land's server answers that is not a JPEG of a sane size is no tile.
 */
@Injectable()
export class MapPhotoService {
  private readonly log = new Logger('MapPhoto');
  private readonly kept = new Map<string, Buffer>();
  private readonly coming = new Map<string, Promise<Buffer | null>>();
  /** Replaced in tests; the platform's fetch otherwise. */
  fetcher: Fetcher = (url, init) => fetch(url, init);

  async tile(t: Tile): Promise<Buffer | null> {
    const key = `${t.z}/${t.x}/${t.y}`;
    const hit = this.kept.get(key);
    if (hit) {
      // Most recently used goes to the end.
      this.kept.delete(key);
      this.kept.set(key, hit);
      return hit;
    }
    const on = this.coming.get(key);
    if (on) return on;
    const p = this.load(t).finally(() => this.coming.delete(key));
    this.coming.set(key, p);
    const got = await p;
    if (got) {
      this.kept.set(key, got);
      while (this.kept.size > KEEP) {
        const oldest = this.kept.keys().next().value as string;
        this.kept.delete(oldest);
      }
    }
    return got;
  }

  private async load(t: Tile): Promise<Buffer | null> {
    try {
      const res = await this.fetcher(dopUrl(t), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/jpeg')) {
        this.log.warn(`photo ${t.z}/${t.x}/${t.y}: ${res.status} ${type}`);
        return null;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0 || body.length > MAX_BYTES) return null;
      return body;
    } catch (e) {
      this.log.warn(`photo ${t.z}/${t.x}/${t.y}: ${(e as Error).name}`);
      return null;
    }
  }
}
