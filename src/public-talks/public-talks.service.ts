import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { CreatePublicTalkDto } from './dto/create-public-talk.dto';
import { UpdatePublicTalkDto } from './dto/update-public-talk.dto';

/**
 * Monday (ISO `YYYY-MM-DD`) of the current week. A public talk only counts as
 * "given" once its week is in the past; the current/upcoming week's assignment
 * is scheduled, not yet delivered.
 */
function currentWeekMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicTalkWithHistory extends PublicTalk {
  lastGivenAt: string | null;
  lastGivenBy: string | null;
  nextGivenAt: string | null;
  nextGivenBy: string | null;
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
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
  ) {}

  /**
   * Lists talks. The catalog itself is global, but the lastGivenAt / lastGivenBy
   * fields attached to each talk are scoped to the supplied congregation.
   */
  async list(
    congregationId: string,
    params: {
      search?: string;
      includeInactive?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<PaginatedResult<PublicTalkWithHistory>> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;

    const qb = this.repo.createQueryBuilder('t');

    if (!params.includeInactive) {
      qb.andWhere('t.isActive = :active', { active: true });
    }

    if (params.search && params.search.trim()) {
      const search = params.search.trim();
      const numeric = parseInt(search, 10);
      if (!isNaN(numeric)) {
        qb.andWhere(
          '(t.title ILIKE :titleLike OR CAST(t.number AS TEXT) LIKE :numLike)',
          { titleLike: `%${search}%`, numLike: `${numeric}%` },
        );
      } else {
        qb.andWhere('t.title ILIKE :titleLike', { titleLike: `%${search}%` });
      }
    }

    qb.orderBy('t.number', 'ASC').skip(offset).take(limit);

    const [talks, total] = await qb.getManyAndCount();

    if (talks.length === 0) {
      return { data: [], total, limit, offset };
    }

    // Fetch all assignments for these talks in this congregation,
    // ordered DESC so the first match per public_talk_id is the latest.
    const talkIds = talks.map((t) => t.id);
    const histories = await this.assignmentsRepo.find({
      where: {
        publicTalkId: In(talkIds),
        congregationId,
      },
      relations: ['publisher'],
      order: { weekStartDate: 'DESC' },
    });

    // "Given" splits at the current week: strictly-past weeks are deliveries that
    // already happened (lastGiven*), the current/future weeks are still scheduled
    // (nextGiven*). The histories come ordered DESC by weekStartDate, so the first
    // past hit per talk is the most recent, and the last future hit is the nearest.
    const currentWeekStart = currentWeekMondayISO();
    const latestByTalk = new Map<string, Assignment>();
    const nextByTalk = new Map<string, Assignment>();
    for (const a of histories) {
      if (a.status === AssignmentStatus.CANCELLED) continue;
      if (!a.publicTalkId) continue;
      if (a.weekStartDate >= currentWeekStart) {
        // Future/current: overwrite so the last (earliest, since DESC) wins.
        nextByTalk.set(a.publicTalkId, a);
      } else if (!latestByTalk.has(a.publicTalkId)) {
        latestByTalk.set(a.publicTalkId, a);
      }
    }

    const speakerOf = (a: Assignment | undefined): string | null => {
      if (!a) return null;
      if (a.publisher) {
        const p = a.publisher;
        return (
          [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null
        );
      }
      return a.speakerName ?? null;
    };

    const data: PublicTalkWithHistory[] = talks.map((t) => {
      const latest = latestByTalk.get(t.id);
      const next = nextByTalk.get(t.id);
      return {
        ...t,
        lastGivenAt: latest?.weekStartDate ?? null,
        lastGivenBy: speakerOf(latest),
        nextGivenAt: next?.weekStartDate ?? null,
        nextGivenBy: speakerOf(next),
      };
    });

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
      throw new ConflictException(`Public talk #${dto.number} already exists`);
    }
    const talk = this.repo.create(dto);
    return this.repo.save(talk);
  }

  async update(id: string, dto: UpdatePublicTalkDto): Promise<PublicTalk> {
    const existing = await this.getById(id);

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

  async deactivate(id: string): Promise<PublicTalk> {
    const existing = await this.getById(id);
    existing.isActive = false;
    return this.repo.save(existing);
  }

  async reactivate(id: string): Promise<PublicTalk> {
    const existing = await this.getById(id);
    existing.isActive = true;
    return this.repo.save(existing);
  }

  async bulkImport(text: string): Promise<BulkImportResult> {
    const lineRegex = /^\s*(\d+)\.\s*(.+?)\s*$/;
    const lines = text.split(/\r?\n/);
    const parsed: Array<{ number: number; title: string }> = [];
    let invalid = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const m = trimmed.match(lineRegex);
      if (!m) {
        if (/^\d/.test(trimmed)) invalid++;
        continue;
      }

      const number = parseInt(m[1], 10);
      const title = m[2].trim();

      if (
        number < 1 ||
        number > 999 ||
        title.length < 3 ||
        title.length > 500
      ) {
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
