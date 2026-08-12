import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ElderTask } from '../entities/elder-task.entity';
import { EldersMeeting } from '../entities/elders-meeting.entity';
import { Publisher } from '../entities/publisher.entity';
import { TaskAddresseesService } from './task-addressees.service';
import { TaskRemindersService } from './task-reminders.service';

export interface AgendaResult {
  meeting: EldersMeeting | null;
  /** Put on this meeting on purpose. */
  onAgenda: ElderTask[];
  /** Past its date and still open — nobody has to remember to look. */
  overdue: ElderTask[];
  /** Falls due before the meeting after this one, so it is worth raising now. */
  dueSoon: ElderTask[];
}

/**
 * Tasks of the body of elders, and the meetings they are going to.
 *
 * The agenda is the point of the whole thing. A list of tasks with no occasion
 * attached goes stale: entries are made, half fall out of date, and the page
 * stops being opened. A meeting is the rhythm the body already has, so the
 * list is built to feed it.
 */
/**
 * What a caller may set on a task.
 *
 * Wider than the entity on purpose: `dueInDays` and `dueInMonths` never reach
 * the database — they are turned into a date on the way in.
 */
export interface TaskInput extends Partial<ElderTask> {
  assigneePublisherIds?: string[];
  dueInDays?: number;
  dueInMonths?: number;
}

/**
 * A period becomes a date at the moment of writing, and stays an ordinary
 * date afterwards.
 *
 * «In three months» kept as a period would have to be recalculated on every
 * read, and would silently move if anybody edited anything near it. Counted
 * once, it is a deadline a person can see and shift — which is what everybody
 * means when they say «by then».
 */
export function resolveDueDate(dto: {
  dueDate?: string | null;
  dueInDays?: number;
  dueInMonths?: number;
}): string | null {
  if (dto.dueDate !== undefined && dto.dueDate !== null) return dto.dueDate;
  const from = new Date();
  if (dto.dueInDays) {
    from.setDate(from.getDate() + dto.dueInDays);
  } else if (dto.dueInMonths) {
    from.setMonth(from.getMonth() + dto.dueInMonths);
  } else {
    return dto.dueDate ?? null;
  }
  return from.toISOString().slice(0, 10);
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(EldersMeeting)
    private readonly meetings: Repository<EldersMeeting>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    private readonly addressees: TaskAddresseesService,
    private readonly reminders: TaskRemindersService,
  ) {}

  // ---- Meetings ---------------------------------------------------------

  listMeetings(congregationId: string): Promise<EldersMeeting[]> {
    return this.meetings.find({
      where: { congregationId },
      order: { date: 'DESC' },
    });
  }

  async createMeeting(
    congregationId: string,
    dto: { date: string; startTime?: string | null; note?: string | null },
    userId: string | null,
  ): Promise<EldersMeeting> {
    const entity = this.meetings.create({
      congregationId,
      date: dto.date,
      startTime: dto.startTime ?? null,
      note: dto.note ?? null,
      createdById: userId,
    });
    return this.meetings.save(entity);
  }

  getMeeting(
    congregationId: string,
    id: string,
  ): Promise<EldersMeeting | null> {
    return this.meetings.findOne({ where: { id, congregationId } });
  }

  /**
   * Turn a draft into an agenda, and tell the body.
   *
   * The word carries the day, the hour and the place — and NOT the items, by
   * the same rule that governs every push in this app: it shows on a locked
   * screen the family can see. Approving twice sends word once; the key sees
   * to that, so a coordinator who taps again out of doubt does not summon
   * everybody a second time.
   */
  async approveMeeting(
    congregationId: string,
    id: string,
    user: { id: string },
  ): Promise<EldersMeeting> {
    const meeting = await this.meetings.findOne({
      where: { id, congregationId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const firstTime = !meeting.approvedAt;
    meeting.approvedAt = meeting.approvedAt ?? new Date();
    meeting.approvedById = meeting.approvedById ?? user.id;
    const saved = await this.meetings.save(meeting);

    if (firstTime) {
      void this.reminders.announceAgendaApproved(saved).catch(() => undefined);
    }
    return saved;
  }

  async updateMeeting(
    congregationId: string,
    id: string,
    dto: { date?: string; startTime?: string | null; note?: string | null },
  ): Promise<EldersMeeting> {
    const entity = await this.meetings.findOne({
      where: { id, congregationId },
    });
    if (!entity) throw new NotFoundException('Meeting not found');
    if (dto.date !== undefined) entity.date = dto.date;
    if (dto.startTime !== undefined) entity.startTime = dto.startTime ?? null;
    if (dto.note !== undefined) entity.note = dto.note ?? null;
    return this.meetings.save(entity);
  }

  async removeMeeting(congregationId: string, id: string): Promise<void> {
    const entity = await this.meetings.findOne({
      where: { id, congregationId },
    });
    if (!entity) throw new NotFoundException('Meeting not found');
    // Tasks pointing at it are not deleted — the link is cleared by the
    // database. Cancelling an evening must not destroy the work.
    await this.meetings.remove(entity);
  }

  // ---- Tasks ------------------------------------------------------------

  /**
   * The list, with WHOM each task reaches worked out.
   *
   * The two bodies carry no stored names, so the screen cannot tell whether a
   * task is «mine» without asking who is in them today. Resolving it here means
   * one lookup for the whole page instead of one per card, and means the app
   * never has to know the rule.
   */
  async listTasks(
    congregationId: string,
    status?: 'open' | 'done',
  ): Promise<(ElderTask & { members: { id: string }[] })[]> {
    const rows = await this.tasks.find({
      where: { congregationId, ...(status ? { status } : {}) },
      relations: { assignees: true },
      order: { dueDate: 'ASC', createdAt: 'DESC' },
    });

    // Both bodies are read once, not per task.
    const committee = rows.some((r) => r.assigneeKind === 'service_committee')
      ? await this.addressees.membersOfKind(congregationId, 'service_committee')
      : [];
    const body = rows.some((r) => r.assigneeKind === 'body_of_elders')
      ? await this.addressees.membersOfKind(congregationId, 'body_of_elders')
      : [];

    return rows.map((task) => ({
      ...task,
      members:
        task.assigneeKind === 'service_committee'
          ? committee
          : task.assigneeKind === 'body_of_elders'
            ? body
            : (task.assignees ?? []),
    })) as (ElderTask & { members: { id: string }[] })[];
  }

  /** Every open task this brother is on, however it was addressed. */
  async myTasks(
    congregationId: string,
    publisherId: string,
  ): Promise<ElderTask[]> {
    const all = await this.listTasks(congregationId, 'open');
    return all.filter((t) => t.members.some((m) => m.id === publisherId));
  }

  async createTask(
    congregationId: string,
    dto: TaskInput & { title: string },
    userId: string | null,
  ): Promise<ElderTask> {
    const entity = this.tasks.create({
      congregationId,
      title: dto.title,
      details: dto.details ?? null,
      area: dto.area ?? 'other',
      assigneeKind: dto.assigneeKind ?? 'people',
      // The old single field goes on being written: the first named brother.
      // Nothing that reads it needs changing, and a task written before the
      // list existed still reads the same way.
      assigneePublisherId:
        dto.assigneePublisherIds?.[0] ?? dto.assigneePublisherId ?? null,
      dueDate: resolveDueDate(dto),
      dueTime: dto.dueTime ?? null,
      kind: dto.kind ?? null,
      kindPeriod: dto.kindPeriod ?? null,
      eldersMeetingId: dto.eldersMeetingId ?? null,
      status: 'open',
      createdById: userId,
    });
    entity.assignees = await this.resolveNamed(congregationId, dto);
    const saved = await this.tasks.save(entity);
    // Told at once. Otherwise the first a brother hears of a task is the day
    // before it is due, which is not notice but a rush.
    void this.reminders.announceAssignment(saved).catch(() => undefined);
    return saved;
  }

  /**
   * The named brothers, and only for the kind that has names.
   *
   * The committee and the body carry none: their members are read from current
   * responsibilities whenever the task is shown, so that replacing the
   * secretary moves the task to whoever holds the office now. Storing the
   * names would freeze a body that is not frozen.
   */
  private async resolveNamed(
    congregationId: string,
    dto: TaskInput,
  ): Promise<Publisher[]> {
    if ((dto.assigneeKind ?? 'people') !== 'people') return [];
    const ids = dto.assigneePublisherIds ?? [];
    if (ids.length === 0) return [];
    return this.publishers.find({
      where: { id: In(ids), congregationId },
    });
  }

  async updateTask(
    congregationId: string,
    id: string,
    dto: TaskInput,
    userId: string | null,
  ): Promise<ElderTask> {
    const entity = await this.tasks.findOne({
      where: { id, congregationId },
      relations: { assignees: true },
    });
    if (!entity) throw new NotFoundException('Task not found');

    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.details !== undefined) entity.details = dto.details ?? null;
    if (dto.area !== undefined) entity.area = dto.area;
    if (dto.assigneeKind !== undefined) {
      entity.assigneeKind = dto.assigneeKind;
      // Switching to a body clears the names rather than leaving them to sit
      // invisibly behind it, waiting to reappear if the kind is switched back.
      if (dto.assigneeKind !== 'people') entity.assignees = [];
    }
    if (dto.assigneePublisherIds !== undefined) {
      entity.assignees = await this.resolveNamed(congregationId, {
        ...dto,
        assigneeKind: dto.assigneeKind ?? entity.assigneeKind,
      });
      entity.assigneePublisherId = entity.assignees[0]?.id ?? null;
    } else if (dto.assigneePublisherId !== undefined) {
      entity.assigneePublisherId = dto.assigneePublisherId ?? null;
    }
    if (dto.dueTime !== undefined) entity.dueTime = dto.dueTime ?? null;
    if (dto.dueDate !== undefined) entity.dueDate = dto.dueDate ?? null;
    else if (dto.dueInDays !== undefined || dto.dueInMonths !== undefined) {
      entity.dueDate = resolveDueDate(dto);
    }
    if (dto.eldersMeetingId !== undefined) {
      entity.eldersMeetingId = dto.eldersMeetingId ?? null;
    }

    if (dto.status !== undefined && dto.status !== entity.status) {
      entity.status = dto.status;
      // Who closed it and when is recorded here rather than left to the
      // journal: it is part of the task's own story, and the agenda reads it.
      entity.doneAt = dto.status === 'done' ? new Date() : null;
      entity.doneById = dto.status === 'done' ? userId : null;
    }

    return this.tasks.save(entity);
  }

  async removeTask(congregationId: string, id: string): Promise<void> {
    const entity = await this.tasks.findOne({ where: { id, congregationId } });
    if (!entity) throw new NotFoundException('Task not found');
    await this.tasks.remove(entity);
  }

  // ---- The agenda -------------------------------------------------------

  /**
   * What belongs in front of the body at a given meeting.
   *
   * Three groups, and none of them requires anybody to remember anything: what
   * was put on the agenda deliberately; what has quietly gone past its date;
   * and what will fall due before they next sit down, which is the last chance
   * to raise it in time.
   */
  async agenda(
    congregationId: string,
    meetingId: string | null,
    today: string,
  ): Promise<AgendaResult> {
    const meeting = meetingId
      ? await this.meetings.findOne({
          where: { id: meetingId, congregationId },
        })
      : await this.nextMeeting(congregationId, today);

    const open = await this.tasks.find({
      where: { congregationId, status: 'open' },
      order: { dueDate: 'ASC', createdAt: 'DESC' },
    });

    const horizon = meeting
      ? await this.meetingAfter(congregationId, meeting.date)
      : null;

    const onAgenda = open.filter(
      (t) => meeting && t.eldersMeetingId === meeting.id,
    );
    const rest = open.filter((t) => !onAgenda.includes(t));

    const overdue = rest.filter((t) => !!t.dueDate && t.dueDate < today);
    const dueSoon = rest.filter(
      (t) =>
        !!t.dueDate &&
        t.dueDate >= today &&
        // Without a following meeting on record, everything ahead counts: it
        // is better to raise something early than to let it pass unmentioned.
        (!horizon || t.dueDate <= horizon.date),
    );

    return { meeting: meeting ?? null, onAgenda, overdue, dueSoon };
  }

  private nextMeeting(
    congregationId: string,
    today: string,
  ): Promise<EldersMeeting | null> {
    return this.meetings
      .createQueryBuilder('m')
      .where('m.congregation_id = :c', { c: congregationId })
      .andWhere('m.date >= :today', { today })
      .orderBy('m.date', 'ASC')
      .getOne();
  }

  private meetingAfter(
    congregationId: string,
    date: string,
  ): Promise<EldersMeeting | null> {
    return this.meetings
      .createQueryBuilder('m')
      .where('m.congregation_id = :c', { c: congregationId })
      .andWhere('m.date > :date', { date })
      .orderBy('m.date', 'ASC')
      .getOne();
  }
}
