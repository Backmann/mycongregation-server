import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { MeetingAnnouncement } from '../entities/meeting-announcement.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Assignment } from '../entities/assignment.entity';
import { Publisher } from '../entities/publisher.entity';
import { WeekRulesService } from '../common/week-rules.service';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import type { WeekRules } from '../common/week-rules';
import { addDaysISO } from '../common/week-rules';
import { mondayOf } from '../common/week';
import { CongregationClock } from '../common/congregation-clock.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import {
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_WRITERS,
  AnnouncementKind,
  chairmanPart,
  isWriter,
} from './announcement-rights';

/** One announcement as a route answers it. */
export interface AnnouncementView {
  id: string;
  position: number;
  text: string;
  isLetter: boolean;
  source: string | null;
  byRule: boolean;
  read: boolean;
  carriedFrom: string | null;
}

export interface MeetingAnnouncements {
  weekStartDate: string;
  kind: AnnouncementKind;
  /** The day the meeting is held, after visits and moves; null if not held. */
  date: string | null;
  time: string | null;
  /**
   * Shown to the writers only: who will read it, and whether he already knows
   * (his part published).
   */
  chairman: { firstName: string; lastName: string; published: boolean } | null;
  items: AnnouncementView[];
}

export interface WeekAnnouncements {
  weekStartDate: string;
  /** False in a convention week: nobody meets, nothing is read. */
  meetingsHeld: boolean;
  meetings: MeetingAnnouncements[];
  /**
   * Written for a meeting the week no longer holds (an assembly entered
   * afterwards): kept and shown, so nothing vanishes without a word.
   */
  unplaced: (AnnouncementView & { kind: AnnouncementKind })[];
}

/** Left unread at a meeting already held — the coordinator decides. */
export interface UnreadPast extends AnnouncementView {
  weekStartDate: string;
  kind: AnnouncementKind;
  date: string;
}

interface Chair {
  userId: string | null;
  firstName: string;
  lastName: string;
  published: boolean;
}

const ENTITY = 'meeting_announcement';
/** How far back an unread announcement is still offered to move on. */
const UNREAD_BACK_DAYS = 21;
/** How far ahead the chairman's own list looks. */
const MINE_AHEAD_DAYS = 14;
const MAX_WEEKS = 8;

function isKind(k: string): k is AnnouncementKind {
  return (ANNOUNCEMENT_KINDS as readonly string[]).includes(k);
}

function view(a: MeetingAnnouncement): AnnouncementView {
  return {
    id: a.id,
    position: a.position,
    text: a.text,
    isLetter: a.isLetter,
    source: a.source,
    byRule: a.byRule,
    read: !!a.readAt,
    carriedFrom: a.carriedFrom,
  };
}

function byPosition(a: MeetingAnnouncement, b: MeetingAnnouncement): number {
  return (
    a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/** Monday of a week asked for: refuses anything that is not a Monday. */
export function assertMonday(week: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '') || mondayOf(week) !== week) {
    throw new BadRequestException(
      refusal('WEEK_NOT_MONDAY', 'weekStartDate must be a Monday.'),
    );
  }
  return week;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectRepository(MeetingAnnouncement)
    private readonly repo: Repository<MeetingAnnouncement>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- Who ----------------------------------------------------------------

  async mayWrite(user: AuthenticatedUser): Promise<boolean> {
    const held = await this.responsibilities.find({
      where: { congregationId: user.congregationId, userId: user.id },
      select: { type: true },
    });
    return isWriter(
      user.role,
      held.map((r) => r.type),
    );
  }

  private async assertWriter(user: AuthenticatedUser): Promise<void> {
    if (!(await this.mayWrite(user))) {
      throw new ForbiddenException(
        refusal(
          'NEEDS_RESPONSIBILITY',
          'Requires the coordinator of the body of elders.',
          { responsibilities: [...ANNOUNCEMENT_WRITERS] },
        ),
      );
    }
  }

  /**
   * The chairmen of the given meetings, keyed «week|kind». Read from the
   * programme each time: the part decides, not who held it before.
   */
  private async chairmen(
    congregationId: string,
    weeks: string[],
  ): Promise<Map<string, Chair>> {
    const out = new Map<string, Chair>();
    if (!weeks.length) return out;
    const parts = await this.assignments.find({
      where: {
        congregationId,
        weekStartDate: In(weeks),
        partKey: In(ANNOUNCEMENT_KINDS.map(chairmanPart)),
        status: In([AssignmentStatus.DRAFT, AssignmentStatus.PUBLISHED]),
      },
      select: {
        weekStartDate: true,
        eventType: true,
        partKey: true,
        publisherId: true,
        status: true,
      },
    });
    const ids = [
      ...new Set(
        parts.map((p) => p.publisherId).filter((x): x is string => !!x),
      ),
    ];
    const cards = ids.length
      ? await this.publishers.find({
          where: { congregationId, id: In(ids) },
          select: { id: true, firstName: true, lastName: true, userId: true },
        })
      : [];
    const card = new Map(cards.map((c) => [c.id, c]));
    for (const p of parts) {
      const kind: AnnouncementKind =
        p.partKey === chairmanPart('weekend') ? 'weekend' : 'midweek';
      const c = p.publisherId ? card.get(p.publisherId) : undefined;
      if (!c) continue;
      out.set(`${p.weekStartDate}|${kind}`, {
        userId: c.userId ?? null,
        firstName: c.firstName,
        lastName: c.lastName,
        published: p.status === AssignmentStatus.PUBLISHED,
      });
    }
    return out;
  }

  private async isChairmanOf(
    user: AuthenticatedUser,
    week: string,
    kind: AnnouncementKind,
  ): Promise<boolean> {
    const c = (await this.chairmen(user.congregationId, [week])).get(
      `${week}|${kind}`,
    );
    // A chairman learns of his part when the meeting is published; until then
    // the announcements are not his to read either.
    return !!c && c.published && c.userId === user.id;
  }

  /** The writers, or the chairman of this very meeting. */
  private async assertReader(
    user: AuthenticatedUser,
    week: string,
    kind: AnnouncementKind,
  ): Promise<void> {
    if (await this.mayWrite(user)) return;
    if (await this.isChairmanOf(user, week, kind)) return;
    throw new ForbiddenException(
      refusal(
        'ANNOUNCEMENT_CHAIRMAN_ONLY',
        'Announcements are for the chairman of this meeting.',
      ),
    );
  }

  // ---- Reading -----------------------------------------------------------

  /** The writers' view: whole weeks from `from`, and what was left unread. */
  async weeks(
    user: AuthenticatedUser,
    from: string,
    count: number,
  ): Promise<{
    weeks: WeekAnnouncements[];
    unread: UnreadPast[];
    today: string;
  }> {
    await this.assertWriter(user);
    const congregationId = user.congregationId;
    const first = assertMonday(from);
    const n = Math.min(Math.max(Math.trunc(count) || 1, 1), MAX_WEEKS);
    const weekList = Array.from({ length: n }, (_, i) =>
      addDaysISO(first, 7 * i),
    );
    const today = await this.clock.todayFor(congregationId);

    // The weeks shown, and the weeks an unread one may still come from.
    const backFrom = mondayOf(addDaysISO(today, -UNREAD_BACK_DAYS));
    const backWeeks: string[] = [];
    for (let w = backFrom; w <= mondayOf(today); w = addDaysISO(w, 7)) {
      backWeeks.push(w);
    }
    const allWeeks = [...new Set([...weekList, ...backWeeks])];
    const rules = await this.weekRules.forWeeks(congregationId, allWeeks);
    const rows = await this.repo.find({
      where: { congregationId, weekStartDate: In(allWeeks) },
    });
    const chairs = await this.chairmen(congregationId, weekList);

    const weeks = weekList.map((w) =>
      this.weekView(w, rules.get(w)!, rows, chairs),
    );

    const unread: UnreadPast[] = [];
    for (const a of rows) {
      if (a.readAt || a.dismissedAt || !isKind(a.eventType)) continue;
      const date = rules.get(a.weekStartDate)?.dateOf(a.eventType) ?? null;
      if (!date || date >= today) continue;
      if (date < addDaysISO(today, -UNREAD_BACK_DAYS)) continue;
      unread.push({
        ...view(a),
        weekStartDate: a.weekStartDate,
        kind: a.eventType,
        date,
      });
    }
    unread.sort(
      (a, b) => a.date.localeCompare(b.date) || a.position - b.position,
    );
    return { weeks, unread, today };
  }

  private weekView(
    week: string,
    r: WeekRules,
    rows: MeetingAnnouncement[],
    chairs: Map<string, Chair>,
  ): WeekAnnouncements {
    const mine = rows.filter((a) => a.weekStartDate === week).sort(byPosition);
    const held = new Set(r.meetings.map((m) => m.kind));
    const meetings: MeetingAnnouncements[] = r.meetings
      .filter((m) => isKind(m.kind))
      .map((m) => {
        const c = chairs.get(`${week}|${m.kind}`);
        return {
          weekStartDate: week,
          kind: m.kind,
          date: m.date,
          time: r.timeOf(m.kind),
          chairman: c
            ? {
                firstName: c.firstName,
                lastName: c.lastName,
                published: c.published,
              }
            : null,
          items: mine.filter((a) => a.eventType === m.kind).map(view),
        };
      });
    const unplaced = mine
      .filter((a) => !isKind(a.eventType) || !held.has(a.eventType))
      .map((a) => ({ ...view(a), kind: a.eventType as AnnouncementKind }));
    return {
      weekStartDate: week,
      meetingsHeld: r.meetingsHeld,
      meetings,
      unplaced,
    };
  }

  /** One meeting's list — for the chairman's screen and the conduct mode. */
  async meeting(
    user: AuthenticatedUser,
    week: string,
    kind: string,
  ): Promise<MeetingAnnouncements> {
    assertMonday(week);
    if (!isKind(kind))
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Unknown meeting kind.', { field: 'kind' }),
      );
    await this.assertReader(user, week, kind);
    const congregationId = user.congregationId;
    const r = await this.weekRules.forWeek(congregationId, week);
    const rows = await this.repo.find({
      where: { congregationId, weekStartDate: week, eventType: kind },
    });
    return {
      weekStartDate: week,
      kind,
      date: r.dateOf(kind),
      time: r.timeOf(kind),
      chairman: null,
      items: rows.sort(byPosition).map(view),
    };
  }

  /**
   * The signed-in person's own coming meetings as chairman, with their
   * announcements — the line on the home screen. Empty for everyone else, and
   * cheap: one query decides that.
   */
  async mine(user: AuthenticatedUser): Promise<MeetingAnnouncements[]> {
    const congregationId = user.congregationId;
    const card = await this.publishers.findOne({
      where: { congregationId, userId: user.id },
      select: { id: true },
    });
    if (!card) return [];
    const today = await this.clock.todayFor(congregationId);
    const parts = await this.assignments.find({
      where: {
        congregationId,
        publisherId: card.id,
        partKey: In(ANNOUNCEMENT_KINDS.map(chairmanPart)),
        weekStartDate: Between(
          mondayOf(today),
          mondayOf(addDaysISO(today, MINE_AHEAD_DAYS)),
        ),
        status: AssignmentStatus.PUBLISHED,
      },
      select: { weekStartDate: true, partKey: true },
    });
    if (!parts.length) return [];
    const weeks = [...new Set(parts.map((p) => p.weekStartDate))];
    const rules = await this.weekRules.forWeeks(congregationId, weeks);
    const rows = await this.repo.find({
      where: { congregationId, weekStartDate: In(weeks) },
    });
    const out: MeetingAnnouncements[] = [];
    for (const p of parts) {
      const kind: AnnouncementKind =
        p.partKey === chairmanPart('weekend') ? 'weekend' : 'midweek';
      const r = rules.get(p.weekStartDate)!;
      const date = r.dateOf(kind);
      if (!date || date < today) continue;
      if (!r.meetings.some((m) => m.kind === kind)) continue;
      out.push({
        weekStartDate: p.weekStartDate,
        kind,
        date,
        time: r.timeOf(kind),
        chairman: null,
        items: rows
          .filter(
            (a) => a.weekStartDate === p.weekStartDate && a.eventType === kind,
          )
          .sort(byPosition)
          .map(view),
      });
    }
    return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }

  // ---- Writing -----------------------------------------------------------

  private async nextPosition(
    congregationId: string,
    week: string,
    kind: string,
  ): Promise<number> {
    const raw = await this.repo
      .createQueryBuilder('a')
      .select('MAX(a.position)', 'max')
      .where(
        'a.congregationId = :congregationId AND a.weekStartDate = :week AND a.eventType = :kind',
        { congregationId, week, kind },
      )
      .getRawOne<{ max: number | null }>();
    return (raw?.max ?? 0) + 1;
  }

  private async journal(
    user: AuthenticatedUser,
    a: MeetingAnnouncement,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    what: string,
  ): Promise<void> {
    try {
      // Facts only: the words stay in the announcement, which is gone after
      // 30 days; the journal keeps a year and must not keep them longer.
      await this.auditLog.logFact({
        tenantId: user.congregationId,
        entityType: ENTITY,
        entityId: a.id,
        action,
        actorUserId: user.id,
        detail: {
          what,
          weekStartDate: a.weekStartDate,
          eventType: a.eventType,
          ...(a.isLetter ? { letter: true } : {}),
        },
      });
    } catch {
      // A journal that fails must never take the work down with it.
    }
  }

  private async own(
    user: AuthenticatedUser,
    id: string,
  ): Promise<MeetingAnnouncement> {
    const a = await this.repo.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!a)
      throw new NotFoundException(
        refusal('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.'),
      );
    return a;
  }

  async create(
    user: AuthenticatedUser,
    dto: {
      weekStartDate: string;
      eventType: string;
      text: string;
      isLetter?: boolean;
      source?: string | null;
      sourceKey?: string | null;
    },
  ): Promise<AnnouncementView> {
    await this.assertWriter(user);
    const week = assertMonday(dto.weekStartDate);
    if (!isKind(dto.eventType)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Unknown meeting kind.', { field: 'kind' }),
      );
    }
    const text = dto.text.trim();
    if (!text)
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Text is empty.', { field: 'text' }),
      );
    const congregationId = user.congregationId;
    const position = await this.nextPosition(
      congregationId,
      week,
      dto.eventType,
    );
    let saved: MeetingAnnouncement;
    try {
      saved = await this.repo.save(
        this.repo.create({
          congregationId,
          weekStartDate: week,
          eventType: dto.eventType,
          position,
          text,
          isLetter: !!dto.isLetter,
          source: dto.source ?? null,
          sourceKey: dto.sourceKey ?? null,
          createdByUserId: user.id,
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException(
          refusal(
            'ANNOUNCEMENT_ALREADY_ADDED',
            'This suggestion has already been added.',
          ),
        );
      }
      throw e;
    }
    await this.journal(user, saved, 'CREATE', 'created');
    return view(saved);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: { text?: string; isLetter?: boolean },
  ): Promise<AnnouncementView> {
    await this.assertWriter(user);
    const a = await this.own(user, id);
    if (dto.text !== undefined) {
      const text = dto.text.trim();
      if (!text)
        throw new BadRequestException(
          refusal('INVALID_FIELD', 'Text is empty.', { field: 'text' }),
        );
      a.text = text;
    }
    if (dto.isLetter !== undefined) a.isLetter = dto.isLetter;
    const saved = await this.repo.save(a);
    await this.journal(user, saved, 'UPDATE', 'edited');
    return view(saved);
  }

  /** The order of reading, as the coordinator arranged it. */
  async order(
    user: AuthenticatedUser,
    dto: { weekStartDate: string; eventType: string; ids: string[] },
  ): Promise<AnnouncementView[]> {
    await this.assertWriter(user);
    const week = assertMonday(dto.weekStartDate);
    const rows = await this.repo.find({
      where: {
        congregationId: user.congregationId,
        weekStartDate: week,
        eventType: dto.eventType,
      },
    });
    const ids = new Set(rows.map((r) => r.id));
    if (
      dto.ids.length !== rows.length ||
      new Set(dto.ids).size !== dto.ids.length ||
      !dto.ids.every((i) => ids.has(i))
    ) {
      throw new BadRequestException(
        refusal(
          'ANNOUNCEMENT_ORDER_INCOMPLETE',
          'The order must name every announcement of the meeting once.',
        ),
      );
    }
    const at = new Map(dto.ids.map((id, i) => [id, i + 1]));
    for (const r of rows) r.position = at.get(r.id)!;
    await this.repo.save(rows);
    return rows.sort(byPosition).map(view);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.assertWriter(user);
    const a = await this.own(user, id);
    await this.repo.remove({ ...a });
    await this.journal(user, a, 'DELETE', 'deleted');
  }

  /** Ticked as read aloud — by the chairman of that meeting, or a writer. */
  async mark(
    user: AuthenticatedUser,
    id: string,
    read: boolean,
  ): Promise<AnnouncementView> {
    const a = await this.own(user, id);
    if (!isKind(a.eventType))
      throw new NotFoundException(
        refusal('ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.'),
      );
    await this.assertReader(user, a.weekStartDate, a.eventType);
    a.readAt = read ? new Date() : null;
    a.readByUserId = read ? user.id : null;
    return view(await this.repo.save(a));
  }

  /**
   * Moved on to another meeting, unread: it keeps the day it was first meant
   * for, so the chairman knows it is not new. Never done by itself (R-01).
   */
  async carry(
    user: AuthenticatedUser,
    id: string,
    dto: { weekStartDate: string; eventType: string },
  ): Promise<AnnouncementView> {
    await this.assertWriter(user);
    const week = assertMonday(dto.weekStartDate);
    if (!isKind(dto.eventType)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Unknown meeting kind.', { field: 'kind' }),
      );
    }
    const a = await this.own(user, id);
    if (!a.carriedFrom && isKind(a.eventType)) {
      const r = await this.weekRules.forWeek(
        user.congregationId,
        a.weekStartDate,
      );
      a.carriedFrom = r.dateOf(a.eventType);
    }
    a.position = await this.nextPosition(
      user.congregationId,
      week,
      dto.eventType,
    );
    a.weekStartDate = week;
    a.eventType = dto.eventType;
    a.readAt = null;
    a.readByUserId = null;
    a.dismissedAt = null;
    const saved = await this.repo.save(a);
    await this.journal(user, saved, 'UPDATE', 'carried');
    return view(saved);
  }

  /** «Убрать»: an unread one let go; it stays until its 30 days are up. */
  async dismiss(user: AuthenticatedUser, id: string): Promise<void> {
    await this.assertWriter(user);
    const a = await this.own(user, id);
    if (a.dismissedAt) return;
    a.dismissedAt = new Date();
    await this.repo.save(a);
  }
}
