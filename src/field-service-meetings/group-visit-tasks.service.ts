import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { ServiceOverseerService } from './service-overseer.service';
import {
  todayIn,
  DEFAULT_CONGREGATION_TIMEZONE,
} from '../common/congregation-clock';

/** It appears in May and is due with the service year. */
const APPEARS_MONTH = 5;
const DUE = { month: 8, day: 31 };

/**
 * «Есть группы, к которым он в этом году ещё не приходил.»
 *
 * The service overseer visits every field-service group at least once a
 * service year. The page has answered which groups are waiting since July —
 * but only to whoever opens it, and a page is opened by somebody who has
 * already remembered.
 *
 * WHY NOT A CALENDAR TASK LIKE THE OTHERS. Those are pure calendar: the
 * accounts check for a quarter belongs in the month after it whatever anybody
 * did. This one depends on what happened — on which groups were visited — so
 * it cannot come from `plansDueBy`, which knows no data at all. It lives here,
 * with the module that owns the meetings, and the tasks module keeps owning
 * only the shape of a task.
 *
 * WHY ONE TASK AND NOT ONE PER GROUP. The title of a calendar task is written
 * by the reader's own app from its `kind` — that is how a Russian sentence
 * stays out of the database. A task per group would therefore read as five
 * identical lines with no group in any of them. So: one task that says there
 * is something to plan, and a link to the page that says what.
 *
 * WHY MAY. The day of a visit is the GROUP's to choose — Lionel's point, and
 * the reason a deadline alone is useless here. Four months is time to ask and
 * be told «not this month», twice, and still go.
 */
@Injectable()
export class GroupVisitTasksService {
  private readonly logger = new Logger(GroupVisitTasksService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly log: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    private readonly overseer: ServiceOverseerService,
  ) {}

  async ensureForToday(now: Date = new Date()): Promise<number> {
    const congregations = await this.congregations.find({
      select: { id: true, timezone: true },
    });
    let changed = 0;

    for (const cong of congregations) {
      // Each congregation's own day, for the same reason the task reminders
      // learned it: a shared «today» is invisibly right until it is not.
      const today = todayIn(
        now,
        cong.timezone || DEFAULT_CONGREGATION_TIMEZONE,
      );
      const month = Number(today.slice(5, 7));
      const year = Number(today.slice(0, 4));
      // The service year is named for the August it ends in.
      const serviceYear = month >= 9 ? year + 1 : year;

      // May through August — before that there is a whole year left to plan
      // in, and a task open for eleven months is furniture, not a reminder.
      if (month < APPEARS_MONTH || month > DUE.month) continue;

      const { waiting } = await this.overseer.groupsAtRisk(
        cong.id,
        serviceYear,
        today,
      );
      const period = String(serviceYear);
      // A task is deleted outright — there is no hidden row to find. What
      // remembers a deliberate deletion is the LOG, checked below.
      const existing = await this.tasks.findOne({
        where: {
          congregationId: cong.id,
          kind: 'service_overseer_visits',
          kindPeriod: period,
        },
      });

      if (waiting.length > 0) {
        if (!existing) {
          const offered = await this.log.findOne({
            where: {
              congregationId: cong.id,
              kind: 'service_overseer_visits',
              period,
            },
          });
          // Deleted on purpose stays deleted for this year — the same rule
          // every calendar task obeys, and Lionel kept it deliberately.
          if (offered) continue;

          await this.create(cong.id, period, serviceYear);
          changed += 1;
          continue;
        }

        /**
         * Re-open what the APP closed, never what a person closed.
         *
         * The task closes itself when every group is covered. But a meeting is
         * deleted outright — no soft delete, no trace — so the visit that
         * closed it can vanish, and then a closed task would quietly assert
         * something untrue for the rest of the year.
         *
         * `doneById` is what tells the two apart: the app leaves it empty, a
         * person leaves his name. We do not argue with a person's decision.
         */
        if (existing.status === 'done' && !existing.doneById) {
          await this.tasks.update(existing.id, {
            status: 'open',
            doneAt: null,
          });
          changed += 1;
        }
        continue;
      }

      // Nothing waiting: close what the app raised. Asking a man to tick off a
      // question that has answered itself is asking him to do our bookkeeping.
      if (existing && existing.status === 'open') {
        await this.tasks.update(existing.id, {
          status: 'done',
          doneAt: new Date(),
          doneById: null,
        });
        changed += 1;
      }
    }

    if (changed > 0) this.logger.log(`group-visit tasks changed: ${changed}`);
    return changed;
  }

  /**
   * Assigned to the service overseer and his assistant by name.
   *
   * By name, because it is their work and the list should say so. Should the
   * appointment change mid-year, the REMINDERS still reach whoever holds it
   * now — task-addressees resolves those separately, so the notice never falls
   * on a brother who no longer serves.
   */
  private async create(
    congregationId: string,
    period: string,
    serviceYear: number,
  ): Promise<void> {
    const held = await this.responsibilities.find({
      where: {
        congregationId,
        type: In([
          ResponsibilityType.SERVICE_OVERSEER,
          ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
        ]),
      },
    });
    const userIds = held.map((r) => r.userId).filter(Boolean) as string[];
    const assignees = userIds.length
      ? await this.publishers.find({
          where: { congregationId, userId: In(userIds), removedAt: IsNull() },
        })
      : [];

    await this.tasks.save(
      this.tasks.create({
        congregationId,
        // A placeholder: the reader's own app writes the words from `kind`.
        title: 'service_overseer_visits',
        details: null,
        area: 'ministry',
        assigneeKind: 'people',
        assignees,
        dueDate: `${serviceYear}-${String(DUE.month).padStart(2, '0')}-${DUE.day}`,
        kind: 'service_overseer_visits',
        kindPeriod: period,
        status: 'open',
        createdById: null,
      }),
    );
    await this.log.save(
      this.log.create({
        congregationId,
        kind: 'service_overseer_visits',
        period,
      }),
    );
  }
}
