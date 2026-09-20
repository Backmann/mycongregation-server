import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { ServiceReportsService } from '../service-reports/service-reports.service';
import { TasksService } from '../tasks/tasks.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * WHAT IS WAITING FOR THIS PERSON — one door instead of four.
 *
 * The home screen makes fifteen requests and is opened more often than any
 * other screen in the app: once a day by everybody in the congregation. Four
 * of those requests answer one question between them — is there anything I
 * have to do — and each is a separate round trip from a phone that may be on
 * a hall's weak signal. The server reaches the same four places either way,
 * but over its own wire.
 *
 * NOTHING IS COMPUTED HERE THAT ALREADY HAS AN OWNER. The report deadline is
 * `myReportStanding`'s, worked out in the congregation's own timezone and
 * deliberately NOT copied into any client — that copy is how the 10th and the
 * 20th came to disagree once before. The tasks are `myTasks`'s. This service
 * only asks them, drops what is not waiting yet, and puts what is left in the
 * order a person would act on it.
 *
 * NOT A WORD OF RUSSIAN, ENGLISH OR GERMAN LEAVES HERE. Each item carries its
 * KIND and its date; the app names it from its own translations. A sentence
 * built on the server would be a fourth place where screen text lives, and
 * the i18n checks in the app cannot see it.
 *
 * WHAT COUNTS AS WAITING — Lionel's rules, 20 September:
 * - THE REPORT, while it applies and has not been handed in.
 * - CONTACTS, if they were last confirmed more than a year ago. Somebody with
 *   no phone and no address at all is never asked: an empty contact may be a
 *   deliberate choice, and turning it into a standing reproach would be wrong.
 * - TASKS, only the overdue ones and those due within a week. A task due next
 *   February is real work, but it is not waiting — and this congregation has
 *   two of those against one that is due tomorrow.
 * - NOT the unaccepted invitation: whoever has not accepted one is not in the
 *   app to be shown anything.
 */

/** Days after which contacts are asked about again. */
const CONTACTS_STALE_DAYS = 365;

/** A task further off than this is work, not something waiting. */
const TASK_HORIZON_DAYS = 7;

/** Beyond this the block would drown the screen it sits on. */
const MAX_ITEMS = 5;

export type PendingKind = 'report' | 'contacts' | 'task';

export interface PendingItem {
  kind: PendingKind;
  /** Set on a task, so the app can open that one. */
  id?: string;
  /** The last day it can be done, or null when nothing is pressing. */
  dueOn: string | null;
  /** True when that day has passed — judged by the congregation's clock. */
  overdue: boolean;
}

export interface PendingResult {
  items: PendingItem[];
  /** How many did not fit under the ceiling; 0 when everything is shown. */
  more: number;
}

@Injectable()
export class MePendingService {
  constructor(
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly reports: ServiceReportsService,
    private readonly tasks: TasksService,
    private readonly clock: CongregationClock,
  ) {}

  async pending(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<PendingResult> {
    const publisher = await this.publishersRepo.findOne({
      where: { congregationId: tenantId, userId: user.id },
    });
    // An account with no card of its own has no report, no contacts and no
    // tasks — there is nothing that could be waiting for it.
    if (!publisher) return { items: [], more: 0 };

    const timezone = await this.clock.timezoneOf(tenantId);
    const today = todayIn(new Date(), timezone);

    const [standing, myTasks] = await Promise.all([
      this.reports.myReportStanding(tenantId, user),
      this.tasks.myTasks(tenantId, publisher.id),
    ]);

    const items: PendingItem[] = [];

    if (standing.applicable && !standing.submitted) {
      items.push({
        kind: 'report',
        dueOn: standing.closesOn,
        overdue: !!standing.closesOn && standing.closesOn < today,
      });
    }

    if (contactsWantConfirming(publisher, today)) {
      items.push({ kind: 'contacts', dueOn: null, overdue: false });
    }

    const horizon = addDaysISO(today, TASK_HORIZON_DAYS);
    for (const task of myTasks) {
      if (!task.dueDate) continue;
      if (task.dueDate > horizon) continue;
      items.push({
        kind: 'task',
        id: task.id,
        dueOn: task.dueDate,
        overdue: task.dueDate < today,
      });
    }

    items.sort(byUrgency);

    return {
      items: items.slice(0, MAX_ITEMS),
      more: Math.max(0, items.length - MAX_ITEMS),
    };
  }
}

/**
 * Overdue first, then by the nearest deadline, then the ones with no deadline
 * at all. Within a day the order is the order they were added, which puts the
 * report ahead of the tasks — it has one date in the month and they do not.
 */
function byUrgency(a: PendingItem, b: PendingItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.dueOn && b.dueOn)
    return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;
  if (a.dueOn) return -1;
  if (b.dueOn) return 1;
  return 0;
}

/**
 * Somebody with neither a phone nor an address is not asked: an empty contact
 * may be a choice. Somebody who has never confirmed is asked once their card
 * is a year old, so that a congregation entering its roster does not find
 * every publisher nagged on the first day.
 */
function contactsWantConfirming(publisher: Publisher, today: string): boolean {
  const hasAny =
    !!publisher.mobilePhone || !!publisher.email || !!publisher.address;
  if (!hasAny) return false;
  const since = publisher.contactsConfirmedAt ?? publisher.createdAt;
  if (!since) return false;
  return isoOf(since) < addDaysISO(today, -CONTACTS_STALE_DAYS);
}

/** A calendar date as YYYY-MM-DD, taken from a stored timestamp. */
function isoOf(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** dateStr + n days, staying a calendar date. */
function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
