import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { TasksService } from '../tasks/tasks.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * WHAT IS WAITING FOR THIS PERSON — contacts to confirm, tasks that are due.
 *
 * THE REPORT IS NOT HERE, on purpose. The home screen already has a card of
 * its own for it, and that card carries two decisions this block cannot: it
 * says «handed in» as plainly as «not handed in», because an empty place where
 * the reminder used to be reads as something broken; and it hides that green
 * line from whoever collects reports, who already sees himself in the
 * collection card below. A list of things to do knows only about the undone —
 * so the report stays with the card that knows both.
 *
 * NO SCREEN TEXT LEAVES HERE, but a task keeps its TITLE. The line between the
 * two is who wrote it: «Проверьте свои контакты» is the app's to say, and it
 * lives in the app's translations where the i18n checks can see it; the title
 * of a task is what a brother typed, there is nothing to translate, and a row
 * that only said «a task, due on the 20th» would not tell anybody which one.
 *
 * WHAT COUNTS AS WAITING — Lionel's rules, 20 September:
 * - CONTACTS, if last confirmed more than a year ago. Somebody with no phone,
 *   no e-mail and no address is never asked: an empty contact may be a
 *   deliberate choice, and turning it into a standing reproach would be wrong.
 * - TASKS, only the overdue ones and those due within a week. A task due next
 *   February is real work, but it is not waiting.
 * - NOT the unaccepted invitation: whoever has not accepted one is not in the
 *   app to be shown anything.
 */

/** Days after which contacts are asked about again. */
const CONTACTS_STALE_DAYS = 365;

/** A task further off than this is work, not something waiting. */
const TASK_HORIZON_DAYS = 7;

/** Beyond this the block would drown the screen it sits on. */
const MAX_ITEMS = 5;

export type PendingKind = 'contacts' | 'task';

export interface PendingItem {
  kind: PendingKind;
  /** Set on a task, so the app can open that one. */
  id?: string;
  /** What a brother called the task. Data, not screen text — never translated. */
  title?: string;
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
    // An account with no card of its own has no contacts and no tasks — there
    // is nothing that could be waiting for it.
    if (!publisher) return { items: [], more: 0 };

    const timezone = await this.clock.timezoneOf(tenantId);
    const today = todayIn(new Date(), timezone);

    const myTasks = await this.tasks.myTasks(tenantId, publisher.id);

    const items: PendingItem[] = [];

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
        title: task.title,
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

/** Overdue first, then by the nearest deadline, then the ones with none. */
function byUrgency(a: PendingItem, b: PendingItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.dueOn && b.dueOn)
    return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0;
  if (a.dueOn) return -1;
  if (b.dueOn) return 1;
  return 0;
}

/**
 * Somebody with neither a phone nor an e-mail nor an address is not asked.
 * Somebody who has never confirmed is asked once their card is a year old, so
 * that a congregation entering its roster does not find every publisher
 * nagged on the first day.
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
