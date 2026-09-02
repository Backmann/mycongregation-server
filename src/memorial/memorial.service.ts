import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { MemorialItem } from '../entities/memorial-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { Duty } from '../entities/duty.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { mondayOf } from '../common/week';
import { minutesOfDayIn, todayIn } from '../common/congregation-clock';
import { formatDay, PUSH_STRINGS } from '../common/i18n/push-strings';
import {
  coerceLanguage,
  DEFAULT_LANGUAGE,
} from '../common/i18n/supported-languages';
import {
  MEMORIAL_DEFAULT_THEME,
  MEMORIAL_SECTION,
  MEMORIAL_TEMPLATE,
} from './memorial-template';

export interface MemorialSheet {
  event: {
    id: string;
    date: string;
    time: string | null;
    address: string | null;
    theme: string | null;
    themeUrl: string | null;
    publishedAt: string | null;
  };
  items: MemorialItem[];
  /** False once the evening has passed: read it, do not rewrite it. */
  editable: boolean;
}

/** The evening-before reminder goes out after this hour, local time. */
const EVENING_BEFORE_HOUR = 19;

@Injectable()
export class MemorialService {
  private readonly logger = new Logger(MemorialService.name);

  constructor(
    @InjectRepository(MemorialItem)
    private readonly repo: Repository<MemorialItem>,
    @InjectRepository(SpecialEvent)
    private readonly eventsRepo: Repository<SpecialEvent>,
    @InjectRepository(Duty)
    private readonly dutiesRepo: Repository<Duty>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    private readonly notifications: NotificationsService,
  ) {}

  private async getEvent(
    congregationId: string,
    specialEventId: string,
  ): Promise<SpecialEvent> {
    const event = await this.eventsRepo.findOne({
      where: { id: specialEventId, congregationId, type: 'memorial' },
    });
    if (!event) throw new NotFoundException('Memorial not found');
    return event;
  }

  /**
   * An evening already past is a record, not a plan.
   *
   * The same rule the circuit visit and the duties of a past meeting follow,
   * in the same words: the day comes from the congregation, and the refusal is
   * written to the journal — a rejection that leaves no trace answers nothing
   * when somebody later asks who tried to change last year's programme.
   */
  private async assertEditable(
    congregationId: string,
    event: SpecialEvent,
  ): Promise<void> {
    const over = event.endDate ?? event.date;
    if (over >= (await this.clock.todayFor(congregationId))) return;

    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: event.id,
      action: 'DENY',
      detail: { reason: 'past_memorial_frozen', memorialDate: over },
    });
    throw new ConflictException(
      'This Memorial has already taken place; its programme is part of the record and can no longer be changed.',
    );
  }

  /** The whole sheet for one Memorial, in the order it is read. */
  async sheet(
    congregationId: string,
    specialEventId: string,
  ): Promise<MemorialSheet> {
    const event = await this.getEvent(congregationId, specialEventId);
    const items = await this.repo.find({
      where: { congregationId, specialEventId },
      order: { section: 'ASC', sortOrder: 'ASC' },
    });
    const over = event.endDate ?? event.date;
    return {
      event: {
        id: event.id,
        date: event.date,
        time: event.time ?? null,
        address: event.address ?? null,
        theme: event.memorialTheme,
        themeUrl: event.memorialThemeUrl,
        publishedAt: event.memorialPublishedAt?.toISOString() ?? null,
      },
      items,
      editable: over >= (await this.clock.todayFor(congregationId)),
    };
  }

  /**
   * Fill an empty Memorial — from LAST YEAR'S, and only from the template when
   * there is no last year.
   *
   * This is what keeps the theme and the songs out of the code. They change
   * when the yearly letter changes; typed once, they carry forward on their
   * own, and so do the zone names a congregation invented for its hall. Names
   * are deliberately NOT carried: who says the prayer is decided afresh.
   */
  async prepare(
    congregationId: string,
    specialEventId: string,
  ): Promise<MemorialSheet> {
    const event = await this.getEvent(congregationId, specialEventId);
    await this.assertEditable(congregationId, event);

    const existing = await this.repo.count({
      where: { congregationId, specialEventId },
    });
    if (existing > 0) return this.sheet(congregationId, specialEventId);

    const previous = await this.findPreviousMemorial(congregationId, event);
    const rows = previous
      ? await this.linesFromPrevious(congregationId, previous)
      : this.linesFromTemplate();

    await this.repo.save(
      rows.map((r) =>
        this.repo.create({ ...r, congregationId, specialEventId }),
      ),
    );

    // The theme travels with the sheet, for the same reason.
    if (!event.memorialTheme) {
      event.memorialTheme = previous?.memorialTheme ?? MEMORIAL_DEFAULT_THEME;
      event.memorialThemeUrl = previous?.memorialThemeUrl ?? null;
      await this.eventsRepo.save(event);
    }

    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: specialEventId,
      after: {
        from: previous ? 'previous_memorial' : 'template',
        lines: rows.length,
      },
    });

    return this.sheet(congregationId, specialEventId);
  }

  /** The most recent Memorial before this one that actually has a programme. */
  private async findPreviousMemorial(
    congregationId: string,
    event: SpecialEvent,
  ): Promise<SpecialEvent | null> {
    const earlier = await this.eventsRepo.find({
      where: { congregationId, type: 'memorial' },
      order: { date: 'DESC' },
    });
    for (const candidate of earlier) {
      if (candidate.id === event.id || candidate.date >= event.date) continue;
      const has = await this.repo.count({
        where: { congregationId, specialEventId: candidate.id },
      });
      if (has > 0) return candidate;
    }
    return null;
  }

  private linesFromTemplate(): Partial<MemorialItem>[] {
    const rows: Partial<MemorialItem>[] = MEMORIAL_TEMPLATE.map((line, i) => ({
      section: MEMORIAL_SECTION.PROGRAMME,
      partKey: line.partKey,
      label: line.label,
      sortOrder: i,
      songNumber: line.songNumber ?? null,
    }));

    // The places and the duties are NOT laid out here any more: they are
    // ordinary duties of a third kind of meeting now, and `generateWeek` puts
    // them out with all the others. What is left here is the order of the
    // evening, which a duty cannot express.
    return rows;
  }

  /** Labels, order and songs — never the people. */
  private async linesFromPrevious(
    congregationId: string,
    previous: SpecialEvent,
  ): Promise<Partial<MemorialItem>[]> {
    const rows = await this.repo.find({
      where: { congregationId, specialEventId: previous.id },
      order: { section: 'ASC', sortOrder: 'ASC' },
    });
    return rows.map((r) => ({
      section: r.section,
      partKey: r.partKey,
      label: r.label,
      sortOrder: r.sortOrder,
      songNumber: r.songNumber,
      // Notes carry over: «светоотражающие жилетки» is true every year.
      note: r.note,
      publisherId: null,
      personText: null,
    }));
  }

  async addLine(
    congregationId: string,
    specialEventId: string,
    input: {
      section: string;
      label: string;
      partKey?: string | null;
      note?: string | null;
    },
    actorUserId?: string,
  ): Promise<MemorialItem> {
    const event = await this.getEvent(congregationId, specialEventId);
    await this.assertEditable(congregationId, event);

    const last = await this.repo.findOne({
      where: { congregationId, specialEventId, section: input.section },
      order: { sortOrder: 'DESC' },
    });
    const entity = this.repo.create({
      congregationId,
      specialEventId,
      section: input.section,
      partKey: input.partKey ?? null,
      label: input.label,
      note: input.note ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
    const saved = await this.repo.save(entity);
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: saved.id,
      actorUserId,
      after: { section: saved.section, label: saved.label },
    });
    return saved;
  }

  async updateLine(
    congregationId: string,
    id: string,
    input: {
      label?: string;
      publisherId?: string | null;
      personText?: string | null;
      songNumber?: number | null;
      note?: string | null;
    },
    actorUserId?: string,
  ): Promise<MemorialItem> {
    const item = await this.repo.findOne({ where: { id, congregationId } });
    if (!item) throw new NotFoundException('Line not found');
    const event = await this.getEvent(congregationId, item.specialEventId);
    await this.assertEditable(congregationId, event);

    const before = { ...item };
    if (input.label !== undefined) item.label = input.label;
    if (input.publisherId !== undefined) item.publisherId = input.publisherId;
    if (input.personText !== undefined) item.personText = input.personText;
    if (input.songNumber !== undefined) item.songNumber = input.songNumber;
    if (input.note !== undefined) item.note = input.note;

    const saved = await this.repo.save(item);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: id,
      actorUserId,
      before,
      after: saved,
      fields: ['label', 'publisherId', 'personText', 'songNumber', 'note'],
    });
    return saved;
  }

  /**
   * Move a line up or down within its own group.
   *
   * By hand, because no automatic order knows any of it: the prayers fall
   * inside the talk, and the rows of a hall read the way the hall is laid out.
   */
  async reorder(
    congregationId: string,
    specialEventId: string,
    section: string,
    orderedIds: string[],
  ): Promise<MemorialItem[]> {
    const event = await this.getEvent(congregationId, specialEventId);
    await this.assertEditable(congregationId, event);

    const rows = await this.repo.find({
      where: { congregationId, specialEventId, section },
    });
    const known = new Set(rows.map((r) => r.id));
    const unknown = orderedIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new NotFoundException(
        'Some of those lines are not part of this Memorial',
      );
    }
    // Anything the caller left out keeps its place at the end, in the order it
    // already had: a partial list must not silently drop lines.
    const rest = rows
      .filter((r) => !orderedIds.includes(r.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => r.id);

    const finalOrder = [...orderedIds, ...rest];
    await Promise.all(
      finalOrder.map((id, i) =>
        this.repo.update({ id, congregationId }, { sortOrder: i }),
      ),
    );
    return this.repo.find({
      where: { congregationId, specialEventId, section },
      order: { sortOrder: 'ASC' },
    });
  }

  async removeLine(
    congregationId: string,
    id: string,
    actorUserId?: string,
  ): Promise<void> {
    const item = await this.repo.findOne({ where: { id, congregationId } });
    if (!item) throw new NotFoundException('Line not found');
    const event = await this.getEvent(congregationId, item.specialEventId);
    await this.assertEditable(congregationId, event);

    await this.repo.softDelete({ id, congregationId });
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: id,
      action: 'DELETE',
      actorUserId,
      detail: { section: item.section, label: item.label },
    });
  }

  /** Put a removed line back where it was. */
  async restoreLine(congregationId: string, id: string): Promise<void> {
    const item = await this.repo.findOne({
      where: { id, congregationId },
      withDeleted: true,
    });
    if (!item) throw new NotFoundException('Line not found');
    if (!item.deletedAt) return;
    const event = await this.getEvent(congregationId, item.specialEventId);
    await this.assertEditable(congregationId, event);
    await this.repo.restore({ id, congregationId });
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'memorial_item',
      entityId: id,
      action: 'RESTORE',
      detail: { section: item.section, label: item.label },
    });
  }

  async setTheme(
    congregationId: string,
    specialEventId: string,
    theme: string | null,
    themeUrl: string | null,
  ): Promise<MemorialSheet> {
    const event = await this.getEvent(congregationId, specialEventId);
    await this.assertEditable(congregationId, event);
    event.memorialTheme = theme;
    event.memorialThemeUrl = themeUrl;
    await this.eventsRepo.save(event);
    return this.sheet(congregationId, specialEventId);
  }

  /**
   * Say the sheet is ready.
   *
   * Until this moment the programme is a draft and nobody is told anything:
   * a Memorial is filled in over months, and a brother should not hear he is
   * saying a prayer while half the lines are still empty. Publishing is the
   * one moment everyone learns at once.
   */
  async publish(
    congregationId: string,
    specialEventId: string,
    actorUserId?: string,
  ): Promise<MemorialSheet> {
    const event = await this.getEvent(congregationId, specialEventId);
    await this.assertEditable(congregationId, event);
    if (!event.memorialPublishedAt) {
      event.memorialPublishedAt = new Date();
      await this.eventsRepo.save(event);
      // The journal has no PUBLISH action, and inventing one would mean a
      // word the rest of the journal does not speak. It is an update to the
      // evening — which is exactly what it is.
      await this.auditLog.logUpdate({
        tenantId: congregationId,
        entityType: 'special_event',
        entityId: specialEventId,
        actorUserId,
        before: { memorialPublishedAt: null },
        after: { memorialPublishedAt: event.memorialPublishedAt },
        fields: ['memorialPublishedAt'],
      });
      // Fire-and-forget, as with the schedule: a push that fails must not
      // undo a publication that succeeded.
      void this.tell(congregationId, event, 'memorialPublished');
    }
    return this.sheet(congregationId, specialEventId);
  }

  /**
   * Everybody written on the evening's sheet, and what each of them has.
   *
   * The programme and the places are ONE sheet to the congregation — the
   * printed page carries both — so they are gathered together here rather
   * than by whichever table they happen to live in. A place is an ordinary
   * duty of the third kind of meeting, which is exactly why it can be asked
   * for by week.
   */
  private async sheetAssignees(
    congregationId: string,
    event: SpecialEvent,
  ): Promise<Map<string, string[]>> {
    const byPublisher = new Map<string, string[]>();
    const add = (publisherId: string | null, label: string) => {
      if (!publisherId) return;
      const list = byPublisher.get(publisherId) ?? [];
      list.push(label);
      byPublisher.set(publisherId, list);
    };

    const lines = await this.repo.find({
      where: { congregationId, specialEventId: event.id },
      order: { sortOrder: 'ASC' },
    });
    for (const line of lines) add(line.publisherId, line.label);

    const duties = await this.dutiesRepo.find({
      where: {
        congregationId,
        weekStartDate: mondayOf(event.date),
        eventType: EventType.MEMORIAL,
      },
      order: { sortOrder: 'ASC' },
    });
    for (const duty of duties) {
      add(duty.publisherId, duty.customLabel || duty.dutyType);
    }

    return byPublisher;
  }

  /**
   * Tell the people on the sheet, and nobody else.
   *
   * Decided on 2 September: publishing does NOT announce the Memorial to the
   * congregation. Whoever has something to do hears what it is; whoever has
   * nothing hears nothing, which is the same rule the meeting programme
   * follows and the reason these notifications are worth leaving switched on.
   */
  private async tell(
    congregationId: string,
    event: SpecialEvent,
    kind: 'memorialPublished' | 'memorialTomorrow',
  ): Promise<void> {
    try {
      const byPublisher = await this.sheetAssignees(congregationId, event);
      if (byPublisher.size === 0) return;

      const publishers = await this.publishersRepo.find({
        where: { congregationId, id: In([...byPublisher.keys()]) },
        select: { id: true, userId: true },
      });
      const userIds = publishers
        .map((p) => p.userId)
        .filter((id): id is string => !!id);
      if (userIds.length === 0) return;

      const users = await this.repo.manager.find(User, {
        where: { id: In(userIds) },
        select: { id: true, uiLanguage: true },
      });
      const langByUserId = new Map(
        users.map((u) => [u.id, coerceLanguage(u.uiLanguage)]),
      );

      for (const publisher of publishers) {
        if (!publisher.userId) continue;
        const mine = byPublisher.get(publisher.id) ?? [];
        if (mine.length === 0) continue;
        const lang = langByUserId.get(publisher.userId) ?? DEFAULT_LANGUAGE;
        const strings = PUSH_STRINGS[lang][kind];
        await this.notifications.notify({
          tenantId: congregationId,
          userIds: [publisher.userId],
          title: strings.title,
          body: strings.body({
            day: formatDay(event.date, lang),
            parts: mine.join(', '),
          }),
          kind: 'memorial',
          key: `memorial:${event.id}:${kind}:${publisher.userId}`,
          data: {
            type:
              kind === 'memorialPublished'
                ? 'memorial_published'
                : 'memorial_tomorrow',
            weekStartDate: mondayOf(event.date),
            specialEventId: event.id,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `memorial notify failed for tenant=${congregationId}: ${
          err?.message ?? err
        }`,
      );
    }
  }

  /**
   * «The Memorial is tomorrow», to the people who have something to do at it.
   *
   * Runs on every pass of the scheduler and sends after seven in the evening
   * LOCAL TIME — the evening before, when a brother can still put a shirt out
   * and read his line. The day boundary is the congregation's own: a second
   * congregation in another zone would otherwise be reminded on the wrong
   * evening, and nothing about the message would look wrong.
   *
   * Sending twice is impossible by the key, not by the window: a pass missed
   * at 19:00 still sends at 19:15, and a pass repeated sends nothing.
   */
  async remindEveningBefore(now: Date = new Date()): Promise<number> {
    const from = todayIn(new Date(now.getTime() - 86400000), 'UTC');
    const to = todayIn(new Date(now.getTime() + 2 * 86400000), 'UTC');
    const upcoming = await this.eventsRepo.find({
      where: { type: 'memorial', date: Between(from, to) },
    });

    let sent = 0;
    for (const event of upcoming) {
      const timezone = await this.clock.timezoneOf(event.congregationId);
      const tomorrow = todayIn(new Date(now.getTime() + 86400000), timezone);
      if (event.date !== tomorrow) continue;
      if (minutesOfDayIn(now, timezone) < EVENING_BEFORE_HOUR * 60) continue;
      await this.tell(event.congregationId, event, 'memorialTomorrow');
      sent += 1;
    }
    if (sent > 0) this.logger.log(`memorial reminders: ${sent}`);
    return sent;
  }

  /** Every Memorial the congregation has recorded, newest first. */
  async list(congregationId: string): Promise<SpecialEvent[]> {
    return this.eventsRepo.find({
      where: { congregationId, type: 'memorial' },
      order: { date: 'DESC' },
    });
  }

  /** Memorials whose programme has been published — for readers. */
  async listPublished(congregationId: string): Promise<SpecialEvent[]> {
    return this.eventsRepo.find({
      where: {
        congregationId,
        type: 'memorial',
        memorialPublishedAt: Not(IsNull()),
      },
      order: { date: 'DESC' },
    });
  }
}
