import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { Congregation } from '../entities/congregation.entity';
import { Duty } from '../entities/duty.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { TalkExchangeStatus } from '../common/enums/talk-exchange.enum';
import {
  todayIn,
  DEFAULT_CONGREGATION_TIMEZONE,
} from '../common/congregation-clock';
import { TaskRemindersService } from './task-reminders.service';

const KIND = 'inactive_holds' as const;
/** The log's mark that a congregation's first, quiet pass is behind it. */
const ARMED = '-';

/** What an inactive publisher still holds from today on — one line each. */
export interface InactiveHold {
  kind:
    | 'part'
    | 'duty'
    | 'cart'
    | 'field_service'
    | 'talk'
    | 'group'
    | 'responsibility';
  /** The day, or the Monday of the week for a meeting part or duty. */
  date: string | null;
  /** True when `date` is the week's Monday rather than the day itself. */
  week: boolean;
  /** Words the app shows as they are (a part's title, a place, a group). */
  label: string | null;
  /** A code the app turns into words (duty type, responsibility type). */
  code: string | null;
}

/** A task's period holds 20 characters; a card's id without its dashes, cut. */
export function periodOf(publisherId: string): string {
  return publisherId.replace(/-/g, '').slice(0, 20);
}

/**
 * «Замена назначений: [имя]» — one task for the body of elders per publisher
 * who has become inactive while something is still his (1 November 2026,
 * variant A).
 *
 * An inactive publisher is given nothing new — the server refuses — but what
 * he already held stays where it was: the elders replace it, or ask whoever
 * plans. This task is how they hear of it. It is raised when he is inactive
 * and holds something from today on, and lowered by itself when nothing is
 * left or he serves again. A task an ELDER closed is not raised again for the
 * same lapse: the log remembers it until he is no longer inactive.
 *
 * The task names nobody in its stored words — the app writes the title from
 * `kind` and asks for the name and the list (the elders' route below). The
 * notice on a locked screen says only that a task was given.
 */
@Injectable()
export class InactiveHoldsService {
  private readonly logger = new Logger(InactiveHoldsService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly log: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    private readonly reminders: TaskRemindersService,
  ) {}

  private repo<T extends object>(entity: new () => T): Repository<T> {
    return this.publishers.manager.getRepository(entity);
  }

  /** Everything he holds from `today` on. */
  async holdsOf(
    congregationId: string,
    publisher: Pick<Publisher, 'id' | 'userId'>,
    today: string,
  ): Promise<InactiveHold[]> {
    const monday = mondayOf(today);
    const pid = publisher.id;
    const out: InactiveHold[] = [];

    const parts = await this.repo(Assignment).find({
      where: [
        {
          congregationId,
          publisherId: pid,
          weekStartDate: MoreThanOrEqual(monday),
          status: Not(AssignmentStatus.CANCELLED),
        },
        {
          congregationId,
          assistantPublisherId: pid,
          weekStartDate: MoreThanOrEqual(monday),
          status: Not(AssignmentStatus.CANCELLED),
        },
      ],
      order: { weekStartDate: 'ASC' },
    });
    for (const a of parts)
      out.push({
        kind: 'part',
        date: a.weekStartDate,
        week: true,
        label: a.partTitle ?? a.importedTitle ?? null,
        code: a.partKey,
      });

    const duties = await this.repo(Duty).find({
      where: {
        congregationId,
        publisherId: pid,
        weekStartDate: MoreThanOrEqual(monday),
      },
      order: { weekStartDate: 'ASC' },
    });
    for (const d of duties)
      out.push({
        kind: 'duty',
        date: d.weekStartDate,
        week: true,
        label: d.customLabel ?? null,
        code: d.dutyType,
      });

    const shifts = await this.repo(CartAssignment).find({
      where: { congregationId, publisherId: pid },
      relations: { day: { location: true } },
    });
    for (const c of shifts)
      if (c.day && c.day.date >= today)
        out.push({
          kind: 'cart',
          date: c.day.date,
          week: false,
          label: c.day.location?.name ?? null,
          code: null,
        });

    const meetings = await this.repo(FieldServiceMeeting).find({
      where: {
        congregationId,
        conductorPublisherId: pid,
        cancelledAt: IsNull(),
        weekStartDate: MoreThanOrEqual(mondayOf(addDays(today, -7))),
      },
    });
    for (const m of meetings) {
      const day = addDays(m.weekStartDate, m.dayOfWeek - 1);
      if (day >= today)
        out.push({
          kind: 'field_service',
          date: day,
          week: false,
          label: null,
          code: null,
        });
    }

    const talks = await this.repo(TalkExchange).find({
      where: {
        congregationId,
        publisherId: pid,
        date: MoreThanOrEqual(today),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    for (const t of talks)
      out.push({
        kind: 'talk',
        date: t.date,
        week: false,
        label: null,
        code: null,
      });

    const groups = await this.repo(ServiceGroup).find({
      where: [
        { congregationId, overseerPublisherId: pid },
        { congregationId, assistantPublisherId: pid },
      ],
    });
    for (const g of groups)
      out.push({
        kind: 'group',
        date: null,
        week: false,
        label: g.name,
        code: g.overseerPublisherId === pid ? 'overseer' : 'assistant',
      });

    if (publisher.userId) {
      const held = await this.responsibilities.find({
        where: { congregationId, userId: publisher.userId },
      });
      for (const r of held)
        out.push({
          kind: 'responsibility',
          date: null,
          week: false,
          label: null,
          code: r.type,
        });
    }

    return out.sort((a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
    );
  }

  /** Raise and lower the tasks for every congregation. */
  async syncAll(now: Date = new Date()): Promise<number> {
    const congregations = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let changed = 0;
    for (const c of congregations) {
      try {
        changed += await this.sync(
          c.id,
          todayIn(now, c.timezone || DEFAULT_CONGREGATION_TIMEZONE),
        );
      } catch (e) {
        this.logger.error(`inactive holds failed for ${c.id}: ${String(e)}`);
      }
    }
    if (changed > 0)
      this.logger.log(`inactive-holds tasks changed: ${changed}`);
    return changed;
  }

  async sync(congregationId: string, today: string): Promise<number> {
    let changed = 0;
    const inactive = await this.publishers.find({
      where: { congregationId, status: PublisherStatus.INACTIVE },
      select: { id: true, userId: true },
    });
    const inactiveByPeriod = new Map(inactive.map((p) => [periodOf(p.id), p]));

    // Lower what the app raised, and re-arm a lapse that has ended.
    const raised = await this.tasks.find({
      where: { congregationId, kind: KIND },
    });
    for (const t of raised) {
      const p = t.kindPeriod ? inactiveByPeriod.get(t.kindPeriod) : undefined;
      const left = p ? await this.holdsOf(congregationId, p, today) : [];
      if (t.status === 'open' && left.length === 0) {
        await this.tasks.update(t.id, {
          status: 'done',
          doneAt: new Date(),
          doneById: null,
        });
        changed += 1;
      }
    }
    const offered = await this.log.find({
      where: { congregationId, kind: KIND },
    });
    for (const o of offered) {
      if (o.period === ARMED || inactiveByPeriod.has(o.period)) continue;
      // He serves again (or is gone): the next lapse is a new one.
      await this.log.delete({ congregationId, kind: KIND, period: o.period });
      await this.tasks.delete({
        congregationId,
        kind: KIND,
        kindPeriod: o.period,
        status: 'done',
      });
    }

    // The very first pass in a congregation finds whoever was inactive
    // before this existed: their tasks appear quietly, without a notice for
    // each — a handful of pushes at once on the day of the update would be
    // noise, not news. From then on every new task is announced.
    const firstPass = !offered.some((o) => o.period === ARMED);
    if (firstPass)
      await this.log.save(
        this.log.create({ congregationId, kind: KIND, period: ARMED }),
      );

    // Raise for whoever is inactive and still holds something.
    for (const p of inactive) {
      const period = periodOf(p.id);
      const open = raised.find(
        (t) => t.kindPeriod === period && t.status === 'open',
      );
      if (open) continue;
      if (
        await this.log.findOne({
          where: { congregationId, kind: KIND, period },
        })
      )
        continue;
      const holds = await this.holdsOf(congregationId, p, today);
      if (holds.length === 0) continue;
      const task = await this.tasks.save(
        this.tasks.create({
          congregationId,
          // A placeholder: the reader's own app writes the words from `kind`.
          title: KIND,
          details: null,
          area: 'organisation',
          assigneeKind: 'body_of_elders',
          assignees: [],
          dueDate: null,
          kind: KIND,
          kindPeriod: period,
          status: 'open',
          createdById: null,
        }),
      );
      await this.log.save(
        this.log.create({ congregationId, kind: KIND, period }),
      );
      // «Вам поручена задача» — no name on a locked screen.
      if (!firstPass)
        await this.reminders
          .announceAssignment(task)
          .catch((e: unknown) =>
            this.logger.warn(`inactive-holds notice failed: ${String(e)}`),
          );
      changed += 1;
    }
    return changed;
  }

  /** For the elders' task card: whose it is and what is left. */
  async forTask(
    congregationId: string,
    taskId: string,
    today: string,
  ): Promise<{ name: string; holds: InactiveHold[] }> {
    const task = await this.tasks.findOne({
      where: { id: taskId, congregationId, kind: KIND },
    });
    if (!task?.kindPeriod) throw new NotFoundException('Task not found');
    const [p] = await this.publishers
      .createQueryBuilder('p')
      .withDeleted()
      .where('p.congregation_id = :congregationId', { congregationId })
      .andWhere(`replace(p.id::text, '-', '') LIKE :prefix`, {
        prefix: `${task.kindPeriod}%`,
      })
      .getMany();
    if (!p) throw new NotFoundException('Task not found');
    return {
      name: p.displayName,
      holds: await this.holdsOf(congregationId, p, today),
    };
  }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDays(iso, 1 - dow);
}
