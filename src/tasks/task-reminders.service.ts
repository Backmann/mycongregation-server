import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ElderTask } from '../entities/elder-task.entity';
import { Publisher } from '../entities/publisher.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TaskAddresseesService } from './task-addressees.service';
import { Congregation } from '../entities/congregation.entity';
import {
  coerceLanguage,
  SupportedLanguage,
} from '../common/i18n/supported-languages';
import { EldersMeeting } from '../entities/elders-meeting.entity';

/**
 * Reminders for the body's own work — the thing this module shipped without.
 *
 * Four moments, and each earns its place:
 *
 *   WHEN IT IS GIVEN. Otherwise a brother first hears of a task the day before
 *   it is due, which is not notice, it is a rush.
 *   THE DAY BEFORE. Time enough to do something about it.
 *   TWO HOURS BEFORE, when an hour was set — the case Lionel named: an
 *   announcement to be read at a meeting, remembered while there is still time
 *   to find the paper.
 *   AGAIN WHEN IT IS LATE. He asked for this in as many words. Once a day, not
 *   every pass: a reminder that arrives hourly stops being read by the second
 *   day, and then nothing is reminded of anything.
 *
 * NO TASK TEXT TRAVELS. Decided in July and unchanged: a push shows on a
 * locked screen the family can see, and «care for publishers in special
 * circumstances» is the most private thing in this app. The notification says
 * that a task is due and nothing else; the words are behind the sign-in.
 *
 * EVERY ADDRESSEE gets it — three for the committee, five for the body. At
 * those numbers it is not noise, and Lionel confirmed it plainly.
 */
/**
 * The words, on the server and in three languages.
 *
 * They cannot come from the app: a push is written when nobody is looking at a
 * screen. My first version passed the KEYS — «task_assigned» — straight into
 * the notification, and that is exactly what arrived on Lionel's phone.
 *
 * HOW MUCH THEY SAY is the careful part. The title of the task never travels:
 * a push shows on a locked screen the family can see, and «care for publishers
 * in special circumstances» is the most private material in this app. What
 * does travel is the AREA — «Объявления», «Счета» — because a category is not
 * a case, and without it «a task is due tomorrow» tells a brother nothing he
 * can act on. He opens the app to read the rest.
 */
const STR: Record<
  SupportedLanguage,
  {
    assigned: string;
    agendaReady: string;
    meetingTomorrow: string;
    tomorrow: string;
    soon: string;
    overdue: string;
    withArea: (area: string, when: string) => string;
  }
> = {
  ru: {
    assigned: 'Вам поручена задача',
    agendaReady: 'Повестка готова',
    meetingTomorrow: 'Завтра встреча совета старейшин',
    tomorrow: 'Задача на завтра',
    soon: 'Задача сегодня',
    overdue: 'Задача просрочена',
    withArea: (area, when) => (when ? `${area} · ${when}` : area),
  },
  en: {
    assigned: 'A task has been given to you',
    agendaReady: 'The agenda is ready',
    meetingTomorrow: 'The elders meet tomorrow',
    tomorrow: 'A task is due tomorrow',
    soon: 'A task is due today',
    overdue: 'A task is overdue',
    withArea: (area, when) => (when ? `${area} · ${when}` : area),
  },
  de: {
    assigned: 'Dir wurde eine Aufgabe übertragen',
    agendaReady: 'Die Tagesordnung ist fertig',
    meetingTomorrow: 'Morgen ist die Ältestenzusammenkunft',
    tomorrow: 'Eine Aufgabe ist morgen fällig',
    soon: 'Eine Aufgabe ist heute fällig',
    overdue: 'Eine Aufgabe ist überfällig',
    withArea: (area, when) => (when ? `${area} · ${when}` : area),
  },
};

/** Area names, said plainly. The category travels; the case does not. */
const AREAS: Record<SupportedLanguage, Record<string, string>> = {
  ru: {
    ministry: 'Служение',
    teaching: 'Обучение',
    care: 'Забота',
    organisation: 'Организация',
    announcements: 'Объявления',
    accounts: 'Счета',
    other: 'Прочее',
  },
  en: {
    ministry: 'Ministry',
    teaching: 'Teaching',
    care: 'Care',
    organisation: 'Organisation',
    announcements: 'Announcements',
    accounts: 'Accounts',
    other: 'Other',
  },
  de: {
    ministry: 'Dienst',
    teaching: 'Schulung',
    care: 'Fürsorge',
    organisation: 'Organisation',
    announcements: 'Bekanntmachungen',
    accounts: 'Konten',
    other: 'Sonstiges',
  },
};

@Injectable()
export class TaskRemindersService {
  private readonly logger = new Logger(TaskRemindersService.name);

  constructor(
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(EldersMeeting)
    private readonly meetings: Repository<EldersMeeting>,
    private readonly addressees: TaskAddresseesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The congregation's own language — a push is written with nobody looking. */
  private async languageOf(congregationId: string): Promise<SupportedLanguage> {
    const cong = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, language: true },
    });
    return coerceLanguage(cong?.language);
  }

  /** «Объявления · 13 августа» — the category and the day, and nothing more. */
  private line(task: ElderTask, lang: SupportedLanguage): string {
    const area = AREAS[lang][task.area] ?? AREAS[lang].other;
    const when = task.dueDate
      ? task.dueTime
        ? `${task.dueDate} · ${task.dueTime}`
        : task.dueDate
      : '';
    return STR[lang].withArea(area, when);
  }

  /** Cards → the user accounts behind them; a card with no login reaches nobody. */
  private userIdsOf(members: Publisher[]): string[] {
    return members.map((p) => p.userId).filter((id): id is string => !!id);
  }

  /**
   * The agenda is settled — every elder is told when and where, and no more.
   *
   * The items themselves never travel: this notification lands on a locked
   * screen, and the questions a body of elders discusses are the last thing
   * that belongs there. Whoever wants them opens the app.
   */
  async announceAgendaApproved(meeting: {
    id: string;
    congregationId: string;
    date: string;
    startTime: string | null;
    placeText: string | null;
  }): Promise<void> {
    const elders = await this.addressees.membersOfKind(
      meeting.congregationId,
      'body_of_elders',
    );
    const userIds = this.userIdsOf(elders);
    if (userIds.length === 0) return;

    const lang = await this.languageOf(meeting.congregationId);
    await this.notifications.notify({
      tenantId: meeting.congregationId,
      userIds,
      title: STR[lang].agendaReady,
      body: this.meetingLine(meeting),
      data: { type: 'agenda_approved', meetingId: meeting.id },
      kind: 'elders_meeting',
      key: `agenda-approved:${meeting.id}`,
    });
  }

  /** «12 августа · 19:00 · Bunsenstr. 46» — the three facts of a meeting. */
  private meetingLine(meeting: {
    date: string;
    startTime: string | null;
    placeText: string | null;
  }): string {
    return [meeting.date, meeting.startTime, meeting.placeText]
      .filter(Boolean)
      .join(' · ');
  }

  /** Told at once, so the notice is notice rather than a rush. */
  async announceAssignment(task: ElderTask): Promise<void> {
    const members = await this.addressees.membersOf(task);
    const userIds = this.userIdsOf(members);
    if (userIds.length === 0) return;

    const lang = await this.languageOf(task.congregationId);
    await this.notifications.notify({
      tenantId: task.congregationId,
      userIds,
      title: STR[lang].assigned,
      body: this.line(task, lang),
      data: { type: 'task_assigned', taskId: task.id },
      kind: 'task',
      // Once per task per person, however often it is saved afterwards.
      key: `task-assigned:${task.id}`,
    });
  }

  /**
   * The three time-based reminders, for one pass of the clock.
   *
   * Run often; each is guarded by a key, so a pass every fifteen minutes sends
   * nothing twice. The overdue key carries the DATE, which is what makes it
   * daily rather than hourly.
   */
  async runDue(now: Date = new Date()): Promise<number> {
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 86400000)
      .toISOString()
      .slice(0, 10);

    const open = await this.tasks.find({
      where: { status: 'open', dueDate: Not(IsNull()) },
      relations: { assignees: true },
    });

    let sent = 0;
    for (const task of open) {
      if (!task.dueDate) continue;

      const due = task.dueDate === tomorrow;
      const late = task.dueDate < today;
      const soon =
        task.dueDate === today &&
        !!task.dueTime &&
        this.withinTwoHours(task, now);

      if (!due && !late && !soon) continue;

      const members = await this.addressees.membersOf(task);
      const userIds = this.userIdsOf(members);
      if (userIds.length === 0) continue;

      const stage = late ? 'overdue' : soon ? 'soon' : 'tomorrow';
      const lang = await this.languageOf(task.congregationId);
      await this.notifications.notify({
        tenantId: task.congregationId,
        userIds,
        title: STR[lang][stage],
        body: this.line(task, lang),
        data: { type: `task_${stage}`, taskId: task.id },
        kind: 'task',
        // The date in the overdue key is what makes it once a day: a reminder
        // arriving hourly stops being read by the second day.
        key:
          stage === 'overdue'
            ? `task-overdue:${task.id}:${today}`
            : `task-${stage}:${task.id}`,
      });
      sent += 1;
    }

    sent += await this.remindOfMeetings(tomorrow);

    if (sent > 0) this.logger.log(`task reminders: ${sent}`);
    return sent;
  }

  /**
   * «The elders meet tomorrow» — for the meeting itself, not its work.
   *
   * Lionel asked for this and was right that it matters more than the notice
   * of approval: knowing the agenda is ready is useful once, and knowing the
   * meeting is tomorrow is useful the evening before.
   */
  private async remindOfMeetings(tomorrow: string): Promise<number> {
    const meetings = await this.meetings.find({
      where: { date: tomorrow, approvedAt: Not(IsNull()) },
    });
    let sent = 0;
    for (const meeting of meetings) {
      const elders = await this.addressees.membersOfKind(
        meeting.congregationId,
        'body_of_elders',
      );
      const userIds = this.userIdsOf(elders);
      if (userIds.length === 0) continue;

      const lang = await this.languageOf(meeting.congregationId);
      await this.notifications.notify({
        tenantId: meeting.congregationId,
        userIds,
        title: STR[lang].meetingTomorrow,
        body: this.meetingLine(meeting),
        data: { type: 'elders_meeting_tomorrow', meetingId: meeting.id },
        kind: 'elders_meeting',
        key: `meeting-tomorrow:${meeting.id}`,
      });
      sent += 1;
    }
    return sent;
  }

  /**
   * Is the hour close enough to warn about.
   *
   * Two hours before, and not before that — a reminder given at breakfast for
   * an evening meeting is forgotten by the evening, which is the failure the
   * whole idea exists to prevent.
   */
  private withinTwoHours(task: ElderTask, now: Date): boolean {
    if (!task.dueTime) return false;
    const [h, m] = task.dueTime.split(':').map((n) => parseInt(n, 10));
    if (!Number.isFinite(h)) return false;
    const at = new Date(now);
    at.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    const minutes = (at.getTime() - now.getTime()) / 60000;
    return minutes > 0 && minutes <= 120;
  }
}
