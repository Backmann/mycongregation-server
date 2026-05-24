import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Song } from '../entities/song.entity';
import { CreateSongDto } from './dto/create-song.dto';
import { UpdateSongDto } from './dto/update-song.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface BulkImportResult {
  parsed: number;
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  examples: Array<{ number: number; title: string }>;
}

/** Header line of a pasted song block: "ПЕСНЯ 35" (RU), "SONG 35", "LIED 35". */
const SONG_HEADER = /^(?:ПЕСНЯ|ПІСНЯ|SONG|LIED)\s+(\d+)\s*(.*)$/i;

/**
 * Parses a pasted song list. Songs come in the JW two-line layout — a header
 * line ("ПЕСНЯ N") followed by the title on the next non-empty line — but an
 * inline form ("ПЕСНЯ N Title") is also accepted. Non-matching lines (e.g. the
 * "ПЕСНИ" heading or blank lines) are ignored. A matched header whose title is
 * missing / too long, or whose number is out of range, is counted as invalid.
 */
export function parseSongList(text: string): {
  items: Array<{ number: number; title: string }>;
  invalid: number;
} {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const items: Array<{ number: number; title: string }> = [];
  let invalid = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SONG_HEADER);
    if (!m) continue;

    const number = parseInt(m[1], 10);
    let title = m[2].trim();

    if (!title) {
      // Title is on the following non-empty line (two-line layout).
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      const next = lines[j] || '';
      if (next && !SONG_HEADER.test(next)) {
        title = next;
        i = j;
      }
    }

    if (!title || number < 1 || number > 999 || title.length > 300) {
      invalid++;
      continue;
    }

    items.push({ number, title });
  }

  return { items, invalid };
}

@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    @InjectRepository(Song)
    private readonly repo: Repository<Song>,
  ) {}

  async list(params: {
    search?: string;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResult<Song>> {
    const limit = params.limit ?? 300;
    const offset = params.offset ?? 0;

    const qb = this.repo.createQueryBuilder('s');

    if (!params.includeInactive) {
      qb.andWhere('s.isActive = :active', { active: true });
    }

    if (params.search && params.search.trim()) {
      const search = params.search.trim();
      const numeric = parseInt(search, 10);
      if (!isNaN(numeric)) {
        qb.andWhere(
          '(s.title ILIKE :titleLike OR CAST(s.number AS TEXT) LIKE :numLike)',
          { titleLike: `%${search}%`, numLike: `${numeric}%` },
        );
      } else {
        qb.andWhere('s.title ILIKE :titleLike', { titleLike: `%${search}%` });
      }
    }

    qb.orderBy('s.number', 'ASC').skip(offset).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

  async getById(id: string): Promise<Song> {
    const song = await this.repo.findOne({ where: { id } });
    if (!song) throw new NotFoundException('Song not found');
    return song;
  }

  async create(dto: CreateSongDto): Promise<Song> {
    const song = this.repo.create({
      number: dto.number,
      title: dto.title,
      isActive: dto.isActive ?? true,
    });
    return this.repo.save(song);
  }

  async update(id: string, dto: UpdateSongDto): Promise<Song> {
    const song = await this.getById(id);
    if (dto.number !== undefined) song.number = dto.number;
    if (dto.title !== undefined) song.title = dto.title;
    if (dto.isActive !== undefined) song.isActive = dto.isActive;
    return this.repo.save(song);
  }

  async deactivate(id: string): Promise<Song> {
    const song = await this.getById(id);
    song.isActive = false;
    return this.repo.save(song);
  }

  async reactivate(id: string): Promise<Song> {
    const song = await this.getById(id);
    song.isActive = true;
    return this.repo.save(song);
  }

  async bulkImport(text: string): Promise<BulkImportResult> {
    const { items, invalid } = parseSongList(text);

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of items) {
      const existing = await this.repo.findOne({
        where: { number: item.number },
      });
      if (existing) {
        if (existing.title !== item.title || !existing.isActive) {
          existing.title = item.title;
          existing.isActive = true;
          await this.repo.save(existing);
          updated++;
        } else {
          unchanged++;
        }
      } else {
        const song = this.repo.create({
          number: item.number,
          title: item.title,
          isActive: true,
        });
        await this.repo.save(song);
        created++;
      }
    }

    this.logger.log(
      `Bulk import: parsed=${items.length}, created=${created}, ` +
        `updated=${updated}, unchanged=${unchanged}, invalid=${invalid}`,
    );

    return {
      parsed: items.length,
      created,
      updated,
      unchanged,
      invalid,
      examples: items.slice(0, 5),
    };
  }
}
