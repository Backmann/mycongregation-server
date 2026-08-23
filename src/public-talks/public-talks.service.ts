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
import { TalkExchange } from '../entities/talk-exchange.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';

/** `2026-10-26` + 6 → `2026-11-01`. Dates only; no timezone enters here. */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. */
function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
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
  /**
   * The date the talk is actually given.
   *
   * A week is stored by its Monday, so «26 октября» was shown for a talk that
   * happens on Sunday the 1st of November — a date the coordinator cannot
   * match against anything he knows. Resolved through the meeting-settings
   * version in force for THAT week, so a congregation that moved its weekend
   * meeting gets its own answer.
   */
  meetingDate: string;
  speakerName: string | null;
  speakerCongregation: string | null;
  /**
   * Where this came from: the weekend programme, a visiting speaker coming to
   * us, or one of our brothers travelling with it.
   */
  source: 'programme' | 'incoming' | 'outgoing';
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

/** One decision about the catalogue: an import, a retirement, or a lifting. */
export interface CatalogueEvent {
  at: string;
  actorName: string | null;
  kind: 'import' | 'retire' | 'lift';
  numbers: number[];
  count: number;
  from: string | null;
  until: string | null;
  reason: string | null;
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
    @InjectRepository(TalkExchange)
    private readonly exchangeRepo: Repository<TalkExchange>,
    @InjectRepository(MeetingSettings)
    private readonly settingsRepo: Repository<MeetingSettings>,
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
    // The dates and the reason go with it. Left behind, a talk would come back
    // to the catalogue still carrying «не преподносить с 1 сентября» — active
    // and forbidden at once, which is a state nobody can act on.
    existing.retiredFrom = null;
    existing.retiredUntil = null;
    existing.retiredReason = null;
    return this.repo.save(existing);
  }

  /**
   * Lift a restriction because a letter said so — with the letter named.
   *
   * The mirror of setting talks aside, and it has to be, because the lifting
   * comes the same way: from an instruction, about particular numbers, on
   * stated grounds. Handled as its own act rather than as «edit the talk», so
   * that a year later the journal answers both «почему сняли» and «почему
   * вернули».
   */
  async liftRestriction(
    tenantId: string,
    numbers: number[],
    actorUserId: string,
    reason?: string | null,
  ): Promise<{ lifted: number }> {
    if (numbers.length === 0) return { lifted: 0 };
    const talks = await this.repo.find({ where: { number: In(numbers) } });
    let lifted = 0;
    for (const talk of talks) {
      if (talk.isActive && !talk.retiredFrom) continue;
      talk.isActive = true;
      talk.retiredFrom = null;
      talk.retiredUntil = null;
      talk.retiredReason = null;
      await this.repo.save(talk);
      lifted++;
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'public_talk_catalog',
      entityId: IMPORT_LOG_ID,
      action: 'RESTORE',
      actorUserId,
      detail: {
        liftedNumbers: numbers.slice(0, 100),
        lifted,
        reason: reason ?? null,
        kind: 'lift',
      },
    });
    return { lifted };
  }

  /**
   * Every decision about the catalogue, newest first.
   *
   * The screen used to show only the last one — and «в прошлый раз» is not the
   * question a coordinator asks. He asks «на основании чего речь 92 снята», and
   * that is answered by a list, each line naming its own letter.
   */
  async catalogueHistory(tenantId: string): Promise<CatalogueEvent[]> {
    const rows = await this.auditLog.findForEntity(
      tenantId,
      'public_talk_catalog',
      IMPORT_LOG_ID,
    );
    return rows.map((r) => {
      const d = (r.after ?? {}) as Record<string, unknown>;
      const isLift = d.kind === 'lift';
      return {
        at: new Date(r.createdAt).toISOString(),
        actorName: r.actorName ?? null,
        kind: isLift
          ? ('lift' as const)
          : r.action === 'DELETE'
            ? ('retire' as const)
            : ('import' as const),
        numbers: ((isLift ? d.liftedNumbers : d.retiredNumbers) ??
          []) as number[],
        count: Number((isLift ? d.lifted : (d.retired ?? d.created)) ?? 0),
        from: (d.from as string) ?? null,
        until: (d.until as string) ?? null,
        reason: (d.reason as string) ?? null,
      };
    });
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
   * The last time talks were set aside — and on what grounds.
   *
   * Setting talks aside happens once or twice a year, so by the time somebody
   * asks «на основании чего», nobody remembers. The journal has recorded it
   * from the first; this simply reads it back.
   */
  async lastRetirement(tenantId: string): Promise<LastImport | null> {
    const rows = await this.auditLog.findForEntity(
      tenantId,
      'public_talk_catalog',
      IMPORT_LOG_ID,
    );
    // Newest first, and only the ones that set talks aside — an import writes
    // against the same entity.
    const latest = rows.find((r) => r.action === 'DELETE');
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

  /**
   * Everywhere on or after `from` where one of these talks is still promised.
   *
   * THREE places, not one. The weekend programme is the obvious one. The
   * coordinator's log holds two more: a visiting speaker bringing the talk to
   * us, and one of our own brothers travelling to another congregation with
   * it. The last is the one that matters most and was missed entirely — he
   * would have gone and given a talk that is no longer used, and nothing here
   * would have said a word.
   */
  private async scheduledAfter(
    congregationId: string,
    talkIds: string[],
    from: string,
  ): Promise<ScheduledUse[]> {
    if (talkIds.length === 0) return [];

    const assignments = await this.assignmentsRepo.find({
      where: {
        congregationId,
        publicTalkId: In(talkIds),
        weekStartDate: MoreThanOrEqual(from),
      },
      order: { weekStartDate: 'ASC' },
    });

    // The exchange log keeps a real DATE, not a week — it is the date the
    // brother travels — so nothing has to be resolved for these.
    const exchange = await this.exchangeRepo.find({
      where: {
        congregationId,
        publicTalkId: In(talkIds),
        date: MoreThanOrEqual(from),
      },
      order: { date: 'ASC' },
    });

    const weekendDow = await this.weekendDowByWeek(
      congregationId,
      assignments.map((a) => a.weekStartDate),
    );

    const fromProgramme: ScheduledUse[] = assignments.map((a) => ({
      publicTalkId: a.publicTalkId as string,
      weekStartDate: a.weekStartDate,
      meetingDate: addDaysISO(
        a.weekStartDate,
        (weekendDow.get(a.weekStartDate) ?? 7) - 1,
      ),
      speakerName: a.speakerName ?? null,
      speakerCongregation: a.speakerCongregation ?? null,
      source: 'programme' as const,
    }));

    const fromExchange: ScheduledUse[] = exchange.map((e) => ({
      publicTalkId: e.publicTalkId as string,
      weekStartDate: mondayOfISO(e.date),
      meetingDate: e.date,
      // Outgoing: our own brother, so his name comes from the linked card and
      // is not repeated here — the screen looks it up. Incoming: the visiting
      // speaker's own name, as the coordinator typed it.
      speakerName: e.speakerName ?? null,
      speakerCongregation: e.speakerCongregation ?? null,
      source: (e.direction === 'outgoing' ? 'outgoing' : 'incoming') as
        | 'outgoing'
        | 'incoming',
    }));

    return [...fromProgramme, ...fromExchange].sort((a, b) =>
      a.meetingDate.localeCompare(b.meetingDate),
    );
  }

  /**
   * Which weekday the weekend meeting fell on, per week.
   *
   * Read per week rather than once: a congregation that moved its meeting has
   * several settings versions, and the one in force is the newest that starts
   * on or before that week.
   */
  private async weekendDowByWeek(
    congregationId: string,
    weeks: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (weeks.length === 0) return out;
    const versions = await this.settingsRepo.find({
      where: { congregationId },
      order: { effectiveFrom: 'ASC' },
    });
    for (const week of weeks) {
      const inForce = [...versions]
        .reverse()
        .find((v) => v.effectiveFrom <= week);
      out.set(week, inForce?.weekendDow ?? 7);
    }
    return out;
  }

  /**
   * Set these talks aside — from a date, optionally until one, and for a
   * stated reason.
   *
   * `until` makes it temporary: the talk returns by itself the day after, so
   * nobody has to remember to restore it. `reason` is the announcement this
   * came from — «Объявления и напоминания, май 2026» — and it is the sentence
   * the coordinator repeats to whoever asks a year later.
   *
   * A talk already set aside is UPDATED rather than skipped: a second
   * instruction about the same talk usually means new dates or a new reason,
   * and skipping it would silently keep the old ones.
   */
  async retireMissing(
    tenantId: string,
    numbers: number[],
    actorUserId: string,
    from?: string,
    until?: string | null,
    reason?: string | null,
  ): Promise<{ retired: number }> {
    if (numbers.length === 0) return { retired: 0 };
    const talks = await this.repo.find({ where: { number: In(numbers) } });
    let retired = 0;
    for (const talk of talks) {
      talk.isActive = false;
      // The dates the instruction gave, so the catalogue can say «не
      // преподносить с 1 сентября по 31 декабря» rather than merely «снята».
      talk.retiredFrom = from ?? null;
      talk.retiredUntil = until ?? null;
      talk.retiredReason = reason ?? null;
      await this.repo.save(talk);
      retired++;
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'public_talk_catalog',
      entityId: IMPORT_LOG_ID,
      action: 'DELETE',
      actorUserId,
      detail: {
        retiredNumbers: numbers.slice(0, 100),
        retired,
        from: from ?? null,
        until: until ?? null,
        reason: reason ?? null,
      },
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
