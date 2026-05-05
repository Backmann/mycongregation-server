import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { CreatePublicTalkDto } from './dto/create-public-talk.dto';
import { UpdatePublicTalkDto } from './dto/update-public-talk.dto';

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

@Injectable()
export class PublicTalksService {
  private readonly logger = new Logger(PublicTalksService.name);

  constructor(
    @InjectRepository(PublicTalk)
    private readonly repo: Repository<PublicTalk>,
  ) {}

  async list(params: {
    search?: string;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResult<PublicTalk>> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;

    const qb = this.repo.createQueryBuilder('t');

    if (!params.includeInactive) {
      qb.andWhere('t.isActive = :active', { active: true });
    }

    if (params.search && params.search.trim()) {
      const search = params.search.trim();
      // Match by partial title (ILIKE) OR by exact/prefix number
      const numeric = parseInt(search, 10);
      if (!isNaN(numeric)) {
        qb.andWhere(
          '(t.title ILIKE :titleLike OR CAST(t.number AS TEXT) LIKE :numLike)',
          {
            titleLike: `%${search}%`,
            numLike: `${numeric}%`,
          },
        );
      } else {
        qb.andWhere('t.title ILIKE :titleLike', { titleLike: `%${search}%` });
      }
    }

    qb.orderBy('t.number', 'ASC').skip(offset).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

  async getById(id: string): Promise<PublicTalk> {
    const talk = await this.repo.findOne({ where: { id } });
    if (!talk) throw new NotFoundException(`PublicTalk ${id} not found`);
    return talk;
  }

  async getByNumber(number: number): Promise<PublicTalk | null> {
    return this.repo.findOne({ where: { number } });
  }

  async create(dto: CreatePublicTalkDto): Promise<PublicTalk> {
    const existing = await this.repo.findOne({
      where: { number: dto.number },
    });
    if (existing) {
      throw new ConflictException(
        `Public talk #${dto.number} already exists`,
      );
    }
    const talk = this.repo.create(dto);
    return this.repo.save(talk);
  }

  async update(id: string, dto: UpdatePublicTalkDto): Promise<PublicTalk> {
    const existing = await this.getById(id);

    // Number change: ensure no conflict
    if (dto.number != null && dto.number !== existing.number) {
      const conflict = await this.repo.findOne({
        where: { number: dto.number },
      });
      if (conflict && conflict.id !== existing.id) {
        throw new ConflictException(
          `Public talk #${dto.number} already exists`,
        );
      }
    }

    Object.assign(existing, dto);
    return this.repo.save(existing);
  }

  /** Soft-disable (preserves FK integrity for past assignments). */
  async deactivate(id: string): Promise<PublicTalk> {
    const existing = await this.getById(id);
    existing.isActive = false;
    return this.repo.save(existing);
  }

  /** Re-enable a previously deactivated talk. */
  async reactivate(id: string): Promise<PublicTalk> {
    const existing = await this.getById(id);
    existing.isActive = true;
    return this.repo.save(existing);
  }

  async bulkImport(text: string): Promise<BulkImportResult> {
    // Match "1. Title", "1.Title", "  1.   Title" — robust to whitespace.
    const lineRegex = /^\s*(\d+)\.\s*(.+?)\s*$/;

    const lines = text.split(/\r?\n/);
    const parsed: Array<{ number: number; title: string }> = [];
    let invalid = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const m = trimmed.match(lineRegex);
      if (!m) {
        // Lines starting with a digit but not matching format → invalid attempt.
        // Pure header text like "Публичные речи" → skip silently.
        if (/^\d/.test(trimmed)) invalid++;
        continue;
      }

      const number = parseInt(m[1], 10);
      const title = m[2].trim();

      if (number < 1 || number > 999 || title.length < 3 || title.length > 500) {
        invalid++;
        continue;
      }

      parsed.push({ number, title });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of parsed) {
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
        const newTalk = this.repo.create({
          number: item.number,
          title: item.title,
          isActive: true,
        });
        await this.repo.save(newTalk);
        created++;
      }
    }

    this.logger.log(
      `Bulk import: parsed=${parsed.length}, created=${created}, ` +
        `updated=${updated}, unchanged=${unchanged}, invalid=${invalid}`,
    );

    return {
      parsed: parsed.length,
      created,
      updated,
      unchanged,
      invalid,
      examples: parsed.slice(0, 5),
    };
  }
}
