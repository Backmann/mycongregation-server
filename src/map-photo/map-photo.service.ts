import { Injectable, Logger } from '@nestjs/common';
import { dopUrl, type Tile } from './photo-tile';

/** How many tiles are kept in memory: a territory at street level, several times over. */
const KEEP = 400;
/** A tile larger than this is not a tile. */
const MAX_BYTES = 1_500_000;
/** The Land's server answers in well under a second; past this the pair is better off without. */
const TIMEOUT_MS = 8000;
/** At most this many asks of the Land at once, whoever asks us (review of 23 November 2026). */
const AT_ONCE = 12;
/** After this many failures in a row the Land is left alone for a while… */
const FAILS_TO_PAUSE = 5;
/** …this long: every tile is «no tile» at once instead of waiting 8 s each. */
const PAUSE_MS = 60_000;

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
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private failsInRow = 0;
  private pausedUntil = 0;
  /** Replaced in tests; the platform's fetch otherwise. */
  fetcher: Fetcher = (url, init) => fetch(url, init);
  /** Replaced in tests. */
  now: () => number = () => Date.now();

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

  /** A place among the few asks of the Land allowed at once. */
  private async slot(): Promise<() => void> {
    if (this.running >= AT_ONCE)
      await new Promise<void>((go) => this.waiting.push(go));
    this.running++;
    return () => {
      this.running--;
      this.waiting.shift()?.();
    };
  }

  private async load(t: Tile): Promise<Buffer | null> {
    // The Land's server down: answer at once, ask again after the pause.
    if (this.now() < this.pausedUntil) return null;
    const free = await this.slot();
    try {
      const got = await this.ask(t);
      if (got) this.failsInRow = 0;
      else if (++this.failsInRow >= FAILS_TO_PAUSE) {
        this.pausedUntil = this.now() + PAUSE_MS;
        this.failsInRow = 0;
        this.log.warn(
          `photo: the Land's server failed ${FAILS_TO_PAUSE} times, pausing ${PAUSE_MS / 1000} s`,
        );
      }
      return got;
    } finally {
      free();
    }
  }

  private async ask(t: Tile): Promise<Buffer | null> {
    try {
      const res = await this.fetcher(dopUrl(t), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/jpeg')) {
        this.log.warn(`photo ${t.z}/${t.x}/${t.y}: ${res.status} ${type}`);
        return null;
      }
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0 || body.length > MAX_BYTES) return null;
      return body;
    } catch (e) {
      this.log.warn(`photo ${t.z}/${t.x}/${t.y}: ${(e as Error).name}`);
      return null;
    }
  }
}
