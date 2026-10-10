import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { FieldServiceMonthRun } from '../entities/field-service-month-run.entity';
import { FieldServiceSettings } from '../entities/field-service-settings.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import {
  todayIn,
  DEFAULT_CONGREGATION_TIMEZONE,
} from '../common/congregation-clock';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { FieldServicePlannerService } from './field-service-planner.service';
import { FieldServiceTemplateService } from './field-service-template.service';

/** Add n days to an ISO 'YYYY-MM-DD' date (UTC, calendar-safe). */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function firstOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}
function addMonths(
  year: number,
  month: number,
  n: number,
): { year: number; month: number } {
  const i = year * 12 + (month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

const LOCALE: Record<SupportedLanguage, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  de: 'de-DE',
};
function monthName(year: number, month: number, lang: SupportedLanguage) {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

const TEXTS: Record<
  SupportedLanguage,
  {
    title: string;
    prepared: string;
    remindPublish: string;
    remindOnly: string;
    published: string;
  }
> = {
  ru: {
    title: 'Встречи для проповеди',
    prepared:
      'Черновик — {month} — готов по шаблону: проверьте его и опубликуйте.',
    remindPublish:
      '{month} ещё черновик. Завтра он опубликуется сам — проверьте, пока не поздно.',
    remindOnly: '{month} ещё черновик — не забудьте опубликовать.',
    published:
      '{month} опубликован автоматически: черновик никто не опубликовал за 7 дней до начала.',
  },
  en: {
    title: 'Field service meetings',
    prepared:
      'The draft for {month} is ready from the template: check it and publish.',
    remindPublish:
      '{month} is still a draft. Tomorrow it publishes itself — check it while you can.',
    remindOnly: '{month} is still a draft — remember to publish it.',
    published:
      '{month} was published automatically: nobody published the draft 7 days before the month.',
  },
  de: {
    title: 'Zusammenkünfte für den Predigtdienst',
    prepared:
      'Der Entwurf für {month} ist nach der Vorlage fertig: prüfen und veröffentlichen.',
    remindPublish:
      '{month} ist noch ein Entwurf. Morgen wird er selbst veröffentlicht – jetzt prüfen.',
    remindOnly: '{month} ist noch ein Entwurf – bitte veröffentlichen.',
    published:
      '{month} wurde automatisch veröffentlicht: niemand hat den Entwurf 7 Tage vor Monatsbeginn veröffentlicht.',
  },
};

/** How many days before the 1st the automatic preparation runs. */
function prepareFromISO(
  year: number,
  month: number,
  lead: FieldServiceSettings['prepareLead'],
): string {
  const first = firstOf(year, month);
  if (lead === '2w') return addDaysISO(first, -14);
  const back = addMonths(year, month, lead === '1m' ? -1 : -2);
  return firstOf(back.year, back.month);
}

/** The 7th day before the month: when a draft publishes itself. */
const AUTO_PUBLISH_DAYS = 7;

export interface AutomationPassResult {
  prepared: number;
  reminded: number;
  published: number;
  tasksClosed: number;
}

/**
 * The month prepared without being asked (October 2026, stage 5).
 *
 * Every night, for each congregation that has opened the new way of
 * planning (its settings row exists):
 *
 *  1. PREPARE — with «Готовить месяц сам» on: when the lead time before a
 *     month has come and the month holds no meeting yet, the template is
 *     made into drafts (conductors picked if the switch says so), and the
 *     service overseer gets a task «Проверить месяц» plus a message.
 *  2. REMIND — the day before a draft would publish itself (8 days before
 *     the month), or 7 days before with «only remind»: one message to the
 *     planners, once.
 *  3. PUBLISH — with «publish itself 7 days before»: a month still holding
 *     drafts 7 days before its 1st is announced, as if the overseer had
 *     pressed the button; the conductors hear once, the planners too.
 *  4. CLOSE — the task closes itself once the month holds no draft, unless a
 *     person closed it already.
 *
 * Each step is written to field_service_month_runs so it happens once,
 * whatever restarts or a second tick. The month the overseer prepared by
 * hand is not prepared again (it already has meetings) but is reminded about
 * and published like any other: the draft's policy is the congregation's,
 * not the author's.
 */
@Injectable()
export class FieldServiceAutomationService {
  private readonly logger = new Logger(FieldServiceAutomationService.name);

  constructor(
    @InjectRepository(FieldServiceSettings)
    private readonly settingsRepo: Repository<FieldServiceSettings>,
    @InjectRepository(FieldServiceMonthRun)
    private readonly runs: Repository<FieldServiceMonthRun>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    private readonly template: FieldServiceTemplateService,
    private readonly planner: FieldServicePlannerService,
    private readonly meetings: FieldServiceMeetingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async ensureForToday(now: Date = new Date()): Promise<AutomationPassResult> {
    const out: AutomationPassResult = {
      prepared: 0,
      reminded: 0,
      published: 0,
      tasksClosed: 0,
    };
    const all = await this.settingsRepo.find();
    for (const settings of all) {
      const cong = await this.congregations.findOne({
        where: { id: settings.congregationId },
        select: { id: true, timezone: true },
      });
      if (!cong) continue;
      const today = todayIn(
        now,
        cong.timezone || DEFAULT_CONGREGATION_TIMEZONE,
      );
      try {
        await this.passFor(settings, today, now, out);
      } catch (e) {
        this.logger.error(
          `field-service automation failed for ${cong.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const total = out.prepared + out.reminded + out.published + out.tasksClosed;
    if (total > 0) {
      this.logger.log(
        `field-service automation: prepared ${out.prepared}, reminded ${out.reminded}, published ${out.published}, tasks closed ${out.tasksClosed}`,
      );
    }
    return out;
  }

  /** One congregation, one day. Public so a test can call it directly. */
  async passFor(
    settings: FieldServiceSettings,
    today: string,
    now: Date,
    out: AutomationPassResult,
  ): Promise<void> {
    const cong = settings.congregationId;
    const y0 = Number(today.slice(0, 4));
    const m0 = Number(today.slice(5, 7));
    // The three months ahead: two months' lead is the longest offered.
    for (let i = 1; i <= 3; i++) {
      const { year, month } = addMonths(y0, m0, i);
      const first = firstOf(year, month);
      const run = await this.runFor(cong, year, month);
      const monthMeetings = await this.template.meetingsOfMonth(
        cong,
        year,
        month,
      );
      let drafts = monthMeetings.filter((m) => m.publishedAt === null);

      // 1. Prepare.
      if (
        settings.autoPrepare &&
        !run.preparedAt &&
        today >= prepareFromISO(year, month, settings.prepareLead)
      ) {
        run.preparedAt = now;
        if (monthMeetings.length === 0) {
          const made = await this.planner.prepare(
            cong,
            year,
            month,
            settings.autoPickConductors,
          );
          if (made.created > 0) {
            out.prepared += 1;
            await this.openTask(cong, year, month, settings, today);
            await this.tellPlanners(cong, year, month, 'prepared');
            drafts = (
              await this.template.meetingsOfMonth(cong, year, month)
            ).filter((m) => m.publishedAt === null);
          }
        }
        await this.runs.save(run);
      }

      if (drafts.length === 0) {
        out.tasksClosed += await this.closeTaskIfOpen(cong, year, month);
        continue;
      }

      // 2. Remind — once, the day before the month would publish itself, or
      //    at the same distance when it never will.
      const publishDay = addDaysISO(first, -AUTO_PUBLISH_DAYS);
      const remindDay =
        settings.unpublishedPolicy === 'publish_7d'
          ? addDaysISO(publishDay, -1)
          : publishDay;
      if (!run.remindedAt && today >= remindDay && today < first) {
        run.remindedAt = now;
        await this.runs.save(run);
        await this.tellPlanners(
          cong,
          year,
          month,
          settings.unpublishedPolicy === 'publish_7d'
            ? 'remindPublish'
            : 'remindOnly',
        );
        out.reminded += 1;
      }

      // 3. Publish.
      if (
        settings.unpublishedPolicy === 'publish_7d' &&
        !run.autoPublishedAt &&
        today >= publishDay &&
        today < first
      ) {
        run.autoPublishedAt = now;
        await this.runs.save(run);
        const res = await this.meetings.publishMonth(cong, year, month);
        if (res.published > 0) {
          out.published += 1;
          await this.tellPlanners(cong, year, month, 'published');
          out.tasksClosed += await this.closeTaskIfOpen(cong, year, month);
        }
      }
    }
  }

  private async runFor(
    congregationId: string,
    year: number,
    month: number,
  ): Promise<FieldServiceMonthRun> {
    return (
      (await this.runs.findOne({ where: { congregationId, year, month } })) ??
      this.runs.create({
        congregationId,
        year,
        month,
        preparedAt: null,
        remindedAt: null,
        autoPublishedAt: null,
      })
    );
  }

  /** The service overseer and his assistant — the ones who may publish. */
  private async planners(congregationId: string) {
    const held = await this.responsibilities.find({
      where: {
        congregationId,
        type: In([
          ResponsibilityType.SERVICE_OVERSEER,
          ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
        ]),
      },
    });
    const userIds = [...new Set(held.map((r) => r.userId).filter(Boolean))];
    const cards = userIds.length
      ? await this.publishers.find({
          where: { congregationId, userId: In(userIds), removedAt: IsNull() },
        })
      : [];
    return { userIds, cards };
  }

  private async tellPlanners(
    congregationId: string,
    year: number,
    month: number,
    what: 'prepared' | 'remindPublish' | 'remindOnly' | 'published',
  ): Promise<void> {
    const { userIds } = await this.planners(congregationId);
    if (userIds.length === 0) return;
    try {
      await this.notifications.notify({
        tenantId: congregationId,
        userIds,
        kind: 'field_service_meeting',
        key: `field-service-month:${congregationId}:${year}-${month}:${what}`,
        text: (lang) => {
          const body = TEXTS[lang][what].replace(
            '{month}',
            monthName(year, month, lang),
          );
          // A month name opens the sentence in two of the texts.
          return {
            title: TEXTS[lang].title,
            body: body.charAt(0).toUpperCase() + body.slice(1),
          };
        },
        data: {
          type: 'field_service_meeting',
          month: `${year}-${String(month).padStart(2, '0')}`,
        },
      });
    } catch (e) {
      this.logger.warn(
        `planner notice failed (${what}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * «Проверить месяц» for the service overseer and his assistant by name.
   * Due the day the month publishes itself — or the 1st, when it never will.
   */
  private async openTask(
    congregationId: string,
    year: number,
    month: number,
    settings: FieldServiceSettings,
    today: string,
  ): Promise<void> {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const existing = await this.tasks.findOne({
      where: {
        congregationId,
        kind: 'field_service_month',
        kindPeriod: period,
      },
    });
    if (existing) return;
    const { cards } = await this.planners(congregationId);
    const first = firstOf(year, month);
    const due =
      settings.unpublishedPolicy === 'publish_7d'
        ? addDaysISO(first, -AUTO_PUBLISH_DAYS)
        : first;
    await this.tasks.save(
      this.tasks.create({
        congregationId,
        // A placeholder: the reader's own app writes the words from `kind`.
        title: 'field_service_month',
        details: null,
        area: 'ministry',
        assigneeKind: 'people',
        assignees: cards,
        dueDate: due < today ? today : due,
        kind: 'field_service_month',
        kindPeriod: period,
        status: 'open',
        createdById: null,
      }),
    );
  }

  /** Closes what the app raised, never what a person closed. */
  private async closeTaskIfOpen(
    congregationId: string,
    year: number,
    month: number,
  ): Promise<number> {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const task = await this.tasks.findOne({
      where: {
        congregationId,
        kind: 'field_service_month',
        kindPeriod: period,
        status: 'open',
      },
    });
    if (!task) return 0;
    await this.tasks.update(task.id, {
      status: 'done',
      doneAt: new Date(),
      doneById: null,
    });
    return 1;
  }
}
