import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { PublicTalk } from '../entities/public-talk.entity';
import { Assignment } from '../entities/assignment.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
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
  /** Talks that were not in the catalogue before. */
  added: Array<{ number: number; title: string }>;
  /** Both wordings, so a change of title can be checked rather than trusted. */
  renamed: Array<{ number: number; from: string; to: string }>;
  /**
   * Active talks the pasted list never mentions — the ones the brothers must
   * be told not to give any more.
   *
   * NOT retired here. A partial paste would otherwise strike out the whole
   * catalogue in one press, and «какие речи больше не говорим» is exactly the
   * question that must not be answered by accident. The screen offers a button.
   */
  missing: Array<{ number: number; title: string }>;
  /** The lines that could not be read, not merely how many. */
  invalidLines: string[];
}

/** One week where a talk is still planned after the date it is retired from. */
export interface ScheduledUse {
  publicTalkId: string;
  weekStartDate: string;
  speakerName: string | null;
  speakerCongregation: string | null;
}

/** What retiring a list of numbers would mean, before it is done. */
export interface RetirementPreview {
  talks: Array<{
    number: number;
    title: string;
    alreadyRetired: boolean;
    scheduled: ScheduledUse[];
  }>;
  /** Numbers the catalogue has never heard of — a typo, or a stale catalogue. */
  unknownNumbers: number[];
  scheduled: ScheduledUse[];
}

/** Who ran the last import and when — read back from the journal. */
export interface LastImport {
  at: string;
  actorName: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * The journal entry that stands for «the catalogue was imported».
 *
 * A fixed id because there is one catalogue: every import writes another row
 * against it, so the history is simply the rows in order.
 */
const IMPORT_LOG_ID = '00000000-0000-0000-0000-0000000000c1';

@Injectable()
export class PublicTalksService {
  private readonly logger = new Logger(PublicTalksService.name);

  constructor(
    @InjectRepository(PublicTalk)
    private readonly repo: Repository<PublicTalk>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    private readonly auditLog: AuditLogService,
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

  /** When the catalogue was last imported, and by whom. */
  async lastImport(tenantId: string): Promise<LastImport | null> {
    const rows = await this.auditLog.findForEntity(
      tenantId,
      'public_talk_catalog',
      IMPORT_LOG_ID,
    );
    const latest = rows[0];
    if (!latest) return null;
    return {
      at: new Date(latest.createdAt).toISOString(),
      actorName: latest.actorName ?? null,
      detail: latest.after ?? null,
    };
  }

  /**
   * Retire the talks a new catalogue no longer lists.
   *
   * Deliberately a separate act from importing: it is the answer to «какие
   * речи больше не говорим», and an answer that important should be given on
   * purpose. Retired talks stay in the catalogue, marked, and can be brought
   * back in one press.
   */
  /**
   * What retiring these numbers would mean, BEFORE anything is retired.
   *
   * Two things the coordinator cannot see for himself: the titles behind
   * thirty bare numbers, and which of those talks are already promised to
   * somebody after the date. A speaker invited in July for the 13th of
   * September is a telephone call, not a database row — so the app shows the
   * call that has to be made and lets him make it.
   */
  async previewRetirement(
    tenantId: string,
    numbers: number[],
    from: string,
  ): Promise<RetirementPreview> {
    if (numbers.length === 0) {
      return { talks: [], unknownNumbers: [], scheduled: [] };
    }
    const found = await this.repo.find({
      where: { number: In(numbers) },
      order: { number: 'ASC' },
    });
    const byNumber = new Map(found.map((t) => [t.number, t]));

    const scheduled = await this.scheduledAfter(
      tenantId,
      found.map((t) => t.id),
      from,
    );
    const scheduledByTalk = new Map<string, ScheduledUse[]>();
    for (const use of scheduled) {
      const list = scheduledByTalk.get(use.publicTalkId) ?? [];
      list.push(use);
      scheduledByTalk.set(use.publicTalkId, list);
    }

    return {
      talks: found.map((t) => ({
        number: t.number,
        title: t.title,
        alreadyRetired: !t.isActive,
        scheduled: scheduledByTalk.get(t.id) ?? [],
      })),
      // Said out loud rather than skipped: a number the catalogue does not
      // have usually means a typo in the paste or a stale catalogue, and both
      // are worth knowing before pressing the button.
      unknownNumbers: numbers.filter((n) => !byNumber.has(n)),
      scheduled,
    };
  }

  /** Weeks on or after `from` where one of these talks is still planned. */
  private async scheduledAfter(
    congregationId: string,
    talkIds: string[],
    from: string,
  ): Promise<ScheduledUse[]> {
    if (talkIds.length === 0) return [];
    const rows = await this.assignmentsRepo.find({
      where: {
        congregationId,
        publicTalkId: In(talkIds),
        weekStartDate: MoreThanOrEqual(from),
      },
      order: { weekStartDate: 'ASC' },
    });
    return rows.map((a) => ({
      publicTalkId: a.publicTalkId as string,
      weekStartDate: a.weekStartDate,
      speakerName: a.speakerName ?? null,
      speakerCongregation: a.speakerCongregation ?? null,
    }));
  }

  async retireMissing(
    tenantId: string,
    numbers: number[],
    actorUserId: string,
    from?: string,
  ): Promise<{ retired: number }> {
    if (numbers.length === 0) return { retired: 0 };
    const talks = await this.repo.find({ where: { number: In(numbers) } });
    let retired = 0;
    for (const talk of talks) {
      if (!talk.isActive) continue;
      talk.isActive = false;
      // The date the instruction gave, so the catalogue can say «снята с
      // 1 сентября 2026» rather than merely «снята».
      talk.retiredFrom = from ?? null;
      await this.repo.save(talk);
      retired++;
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'public_talk_catalog',
      entityId: IMPORT_LOG_ID,
      action: 'DELETE',
      actorUserId,
      detail: { retiredNumbers: numbers.slice(0, 100), retired },
    });
    return { retired };
  }

  async bulkImport(
    text: string,
    tenantId?: string,
    actorUserId?: string,
  ): Promise<BulkImportResult> {
    const lineRegex = /^\s*(\d+)\.\s*(.+?)\s*$/;
    const lines = text.split(/\r?\n/);
    const parsed: Array<{ number: number; title: string }> = [];
    const invalidLines: string[] = [];
    let invalid = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const m = trimmed.match(lineRegex);
      if (!m) {
        if (/^\d/.test(trimmed)) {
          invalid++;
          if (invalidLines.length < 20) invalidLines.push(trimmed);
        }
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
        if (invalidLines.length < 20) invalidLines.push(trimmed);
        continue;
      }

      parsed.push({ number, title });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const added: Array<{ number: number; title: string }> = [];
    const renamed: Array<{ number: number; from: string; to: string }> = [];

    for (const item of parsed) {
      const existing = await this.repo.findOne({
        where: { number: item.number },
      });
      if (existing) {
        if (existing.title !== item.title || !existing.isActive) {
          if (existing.title !== item.title) {
            renamed.push({
              number: item.number,
              from: existing.title,
              to: item.title,
            });
          }
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
        added.push({ number: item.number, title: item.title });
      }
    }

    this.logger.log(
      `Bulk import: parsed=${parsed.length}, created=${created}, ` +
        `updated=${updated}, unchanged=${unchanged}, invalid=${invalid}`,
    );

    // What the catalogue holds that this list never mentions. Asked only when
    // something was actually imported: an empty paste must not report every
    // talk in the catalogue as gone.
    let missing: Array<{ number: number; title: string }> = [];
    if (parsed.length > 0) {
      const pasted = new Set(parsed.map((p) => p.number));
      const active = await this.repo.find({
        where: { isActive: true },
        order: { number: 'ASC' },
      });
      missing = active
        .filter((t) => !pasted.has(t.number))
        .map((t) => ({ number: t.number, title: t.title }));
    }

    if (tenantId) {
      await this.auditLog.logEvent({
        tenantId,
        entityType: 'public_talk_catalog',
        entityId: IMPORT_LOG_ID,
        action: 'RESTORE',
        actorUserId: actorUserId ?? null,
        detail: {
          parsed: parsed.length,
          created,
          updated,
          unchanged,
          invalid,
          missing: missing.length,
        },
      });
    }

    return {
      parsed: parsed.length,
      created,
      updated,
      unchanged,
      invalid,
      examples: parsed.slice(0, 5),
      added,
      renamed,
      missing,
      invalidLines,
    };
  }
}
