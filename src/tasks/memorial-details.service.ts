import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { addDaysISO } from '../common/week-rules';
import { TaskRemindersService } from './task-reminders.service';

const KIND = 'memorial_details' as const;
/** Raised this many days before the Memorial… */
export const MEMORIAL_DETAILS_FROM_DAYS = 42;
/** …and due this many days before it. */
export const MEMORIAL_DETAILS_DUE_DAYS = 28;

/** What the Memorial still lacks: its hour, or — held elsewhere — its address. */
export function memorialMissing(e: {
  time: string | null;
  address: string | null;
  elsewhere?: boolean | null;
}): boolean {
  return !e.time?.trim() || (!!e.elsewhere && !e.address?.trim());
}

/**
 * «Указать время и место Вечери» (27 November 2026).
 *
 * The Memorial may be entered months ahead without its hour, or «elsewhere»
 * without an address: often neither is known weeks before. Lest it reach its
 * evening still without them, the body coordinator (and his assistant) get a
 * task six weeks before, due four weeks before. It closes itself once both
 * are there and opens again if one is taken away; goes when the Memorial is
 * moved or deleted (and comes back for the new day if still needed) or its
 * evening passes with nothing done. One closed by hand stays closed.
 * Period: the Memorial's date.
 */
@Injectable()
export class MemorialDetailsService {
  private readonly logger = new Logger(MemorialDetailsService.name);

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
    private readonly clock: CongregationClock,
    private readonly reminders: TaskRemindersService,
  ) {}

  private events(): Repository<SpecialEvent> {
    return this.tasks.manager.getRepository(SpecialEvent);
  }

  async syncAll(): Promise<number> {
    const congregations = await this.congregations.find({
      select: { id: true },
    });
    let changed = 0;
    for (const c of congregations) {
      try {
        changed += await this.sync(c.id);
      } catch (e) {
        this.logger.error(`memorial-details failed for ${c.id}: ${String(e)}`);
      }
    }
    return changed;
  }

  async sync(congregationId: string): Promise<number> {
    const today = await this.clock.todayFor(congregationId);
    let changed = 0;
    const memorials = await this.events().find({
      where: { congregationId, type: 'memorial', deletedAt: IsNull() },
    });
    const byDate = new Map(memorials.map((m) => [m.date, m]));

    // What the app raised: done when the details came, gone with its day.
    const raised = await this.tasks.find({
      where: { congregationId, kind: KIND, createdById: IsNull() },
    });
    for (const t of raised) {
      const m = t.kindPeriod ? byDate.get(t.kindPeriod) : undefined;
      if (!m) {
        // Moved or deleted: an open one nobody closed goes with its line, so
        // the new day can raise its own.
        if (t.status === 'open') {
          await this.tasks.delete(t.id);
          await this.log.delete({
            congregationId,
            kind: KIND,
            period: t.kindPeriod!,
          });
          changed += 1;
        }
        continue;
      }
      // Its evening came and went with the details still missing: there is
      // nothing left to do, and «done» would say it was done — it goes.
      if (t.status === 'open' && m.date < today) {
        await this.tasks.delete(t.id);
        changed += 1;
        continue;
      }
      if (t.status === 'open' && !memorialMissing(m)) {
        await this.tasks.update(t.id, {
          status: 'done',
          doneAt: new Date(),
          doneById: null,
        });
        changed += 1;
        continue;
      }
      // Closed by the app (nobody's hand) and the hour or place taken away
      // again: it opens again. One an elder closed stays closed.
      if (
        t.status === 'done' &&
        !t.doneById &&
        memorialMissing(m) &&
        m.date >= today
      ) {
        await this.tasks.update(t.id, {
          status: 'open',
          doneAt: null,
          doneById: null,
        });
        changed += 1;
      }
    }

    for (const m of memorials) {
      if (!memorialMissing(m)) continue;
      if (m.date < today) continue;
      if (addDaysISO(m.date, -MEMORIAL_DETAILS_FROM_DAYS) > today) continue;
      const offered = await this.log.findOne({
        where: { congregationId, kind: KIND, period: m.date },
      });
      if (offered) continue;
      const due = addDaysISO(m.date, -MEMORIAL_DETAILS_DUE_DAYS);
      const task = await this.tasks.save(
        this.tasks.create({
          congregationId,
          // A placeholder: the reader's own app writes the words from `kind`.
          title: KIND,
          details: null,
          area: 'organisation',
          assigneeKind: 'people',
          assignees: await this.coordinators(congregationId),
          dueDate: due < today ? today : due,
          kind: KIND,
          kindPeriod: m.date,
          status: 'open',
          createdById: null,
        }),
      );
      task.assigneePublisherId = task.assignees[0]?.id ?? null;
      await this.tasks.save(task);
      await this.log
        .createQueryBuilder()
        .insert()
        .values({ congregationId, kind: KIND, period: m.date })
        .orIgnore()
        .execute();
      await this.reminders
        .announceAssignment(task)
        .catch((e: unknown) =>
          this.logger.warn(`memorial-details notice failed: ${String(e)}`),
        );
      changed += 1;
    }
    return changed;
  }

  /** Whoever keeps the Memorial: the body coordinator and his assistant. */
  private async coordinators(congregationId: string): Promise<Publisher[]> {
    const held = await this.responsibilities.find({
      where: {
        congregationId,
        type: In([
          ResponsibilityType.BODY_COORDINATOR,
          ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
        ]),
      },
    });
    const userIds = held.map((r) => r.userId).filter(Boolean) as string[];
    return userIds.length
      ? this.publishers.find({
          where: { congregationId, userId: In(userIds), removedAt: IsNull() },
        })
      : [];
  }
}
