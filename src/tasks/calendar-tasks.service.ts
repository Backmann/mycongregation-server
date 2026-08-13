import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import {
  ElderTask,
  TaskArea,
  TaskAssigneeKind,
  TaskKind,
} from '../entities/elder-task.entity';

/**
 * The things that come round on the calendar, put on the list by the app.
 *
 * WHY NOT THE REPEAT QUESTION WE ALREADY HAVE. Closing a task asks «repeat in
 * how many months?», and for most work that is exactly right — it repeats from
 * when it was actually done. These three do not. The accounts check for
 * December to February belongs in March whether the previous one was closed in
 * good time or dragged into May; the service year ends on the last day of
 * August whatever happened in the spring. They are fixed to the calendar, and
 * the calendar does not wait.
 *
 * WHY THEY APPEAR BEFORE THEY ARE DUE. A task that arrives on the day it is
 * due is already late. Each carries two dates: the day it shows up, and the day
 * it should be finished — with room between them sized to the work. The accounts
 * check gets the widest room: papers arrive around the fifth and the work
 * itself can take from one week to three, so it is due at the end of the month
 * and the date can be moved like any other.
 *
 * WHY NO SETTING TO TURN THEM OFF. «Это шаблон для всех собраний по всему
 * миру» — Lionel. A congregation that does not want one in a given year deletes
 * it, and it is not created again that year; next year it returns.
 *
 * TITLES ARE NOT WRITTEN HERE. The app creates these by itself, and a
 * congregation may read German or English; a Russian sentence stored in the
 * database would be wrong for them and unfixable afterwards. What is stored is
 * the KIND and the PERIOD, and the reader's own app writes the words.
 */

export interface CalendarTaskPlan {
  kind: TaskKind;
  /** Which turn of it — «2026-Q3», «2026». Also what makes it unique. */
  period: string;
  /** Month and day it appears, 1-based. */
  appears: { month: number; day: number };
  /** Month and day it is due. */
  due: { month: number; day: number };
  area: TaskArea;
  assigneeKind: TaskAssigneeKind;
}

/** Quarters as they are counted here: Sep–Nov, Dec–Feb, Mar–May, Jun–Aug. */
const AUDIT_QUARTERS = [
  { endsMonth: 11, checkMonth: 12, label: 'Q1' },
  { endsMonth: 2, checkMonth: 3, label: 'Q2' },
  { endsMonth: 5, checkMonth: 6, label: 'Q3' },
  { endsMonth: 8, checkMonth: 9, label: 'Q4' },
];

const lastDayOf = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Everything that should exist by this date, for the twelve months around it.
 *
 * Returns plans, not tasks: what to create is decided here and separately from
 * the writing, which makes both testable without a database.
 */
export function plansDueBy(today: Date): CalendarTaskPlan[] {
  const out: CalendarTaskPlan[] = [];
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const reached = (m: number, d: number) =>
    month > m || (month === m && day >= d);

  /**
   * Has its own deadline already gone by.
   *
   * «It appears once its start date is reached» is right for a job that runs
   * every night — but on the FIRST night it looks back over the whole year and
   * offers everything at once, deadline and all. Switched on in August, it put
   * three items on the list overdue by 165, 135 and 44 days: work whose season
   * had passed months before the app knew about it.
   *
   * So a period whose deadline is behind us is not offered. Somebody who wants
   * it anyway can write it himself; an app should not open by announcing
   * failures nobody could have avoided.
   *
   * The cost, stated plainly: were the nightly job broken for a whole month,
   * that month's work would go unoffered. That is a larger fault than a missed
   * task and would announce itself in other ways.
   */
  const stillDue = (m: number, d: number) =>
    month < m || (month === m && day <= d);

  // Review of the pioneers' ministry — appears mid-February, due 1 March.
  if (reached(2, 15) && stillDue(3, 1)) {
    out.push({
      kind: 'pioneer_service_review',
      period: String(year),
      appears: { month: 2, day: 15 },
      due: { month: 3, day: 1 },
      area: 'ministry',
      assigneeKind: 'people',
    });
  }

  // End of the service year — appears 20 August, due the 31st. Lionel was
  // precise about this: not September, and «без промедления».
  if (reached(8, 20) && stillDue(8, 31)) {
    out.push({
      kind: 'service_year_review',
      period: String(year),
      appears: { month: 8, day: 20 },
      due: { month: 8, day: 31 },
      area: 'ministry',
      assigneeKind: 'service_committee',
    });
  }

  // The accounts check, once a quarter. The period named is the quarter being
  // CHECKED, not the month of the checking.
  for (const q of AUDIT_QUARTERS) {
    if (!reached(q.checkMonth, 1)) continue;
    // The deadline is the last day of the checking month.
    if (!stillDue(q.checkMonth, lastDayOf(year, q.checkMonth))) continue;
    // The quarter ending in February belongs to the year it ended in, which is
    // the year the check happens — the label follows the check, so December's
    // work and March's cannot collide.
    out.push({
      kind: 'accounts_audit',
      period: `${year}-${q.label}`,
      appears: { month: q.checkMonth, day: 1 },
      due: {
        month: q.checkMonth,
        day: lastDayOf(year, q.checkMonth),
      },
      area: 'accounts',
      assigneeKind: 'people',
    });
  }

  return out;
}

@Injectable()
export class CalendarTasksService {
  private readonly logger = new Logger(CalendarTasksService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly log: Repository<ElderTaskCalendarLog>,
  ) {}

  /**
   * Create whatever is missing, for every congregation.
   *
   * A task deleted on purpose does NOT come back: the unique index on kind and
   * period is not enough for that, because a deleted row frees the key. So the
   * check is «has this period ever been created», and the app looks for the row
   * INCLUDING soft-deleted ones. Deleting means deciding, and the app does not
   * argue with a decision.
   */
  async ensureForToday(today: Date = new Date()): Promise<number> {
    const plans = plansDueBy(today);
    if (plans.length === 0) return 0;

    const congregations = await this.congregations.find({
      select: { id: true },
    });
    let made = 0;

    for (const cong of congregations) {
      for (const plan of plans) {
        // The LOG, not the task: a task deleted on purpose must not come back,
        // and a deleted row remembers nothing.
        const offered = await this.log.findOne({
          where: {
            congregationId: cong.id,
            kind: plan.kind,
            period: plan.period,
          },
        });
        if (offered) continue;

        const year = today.getUTCFullYear();
        const due = `${year}-${String(plan.due.month).padStart(2, '0')}-${String(
          plan.due.day,
        ).padStart(2, '0')}`;

        await this.tasks.save(
          this.tasks.create({
            congregationId: cong.id,
            // A placeholder the app never shows: the reader's own language
            // writes the words from `kind`. Stored so the column is not empty
            // for anything reading the table directly.
            title: plan.kind,
            details: null,
            area: plan.area,
            assigneeKind: plan.assigneeKind,
            dueDate: due,
            kind: plan.kind,
            kindPeriod: plan.period,
            status: 'open',
            createdById: null,
          }),
        );
        await this.log.save(
          this.log.create({
            congregationId: cong.id,
            kind: plan.kind,
            period: plan.period,
          }),
        );
        made += 1;
      }
    }

    if (made > 0) this.logger.log(`calendar tasks created: ${made}`);
    return made;
  }
}
