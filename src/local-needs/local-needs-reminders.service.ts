import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { shortDay } from '../assignment-reminders/digest';
import type { SupportedLanguage } from '../common/i18n/supported-languages';
import { LocalNeedsService } from './local-needs.service';

export const LOCAL_NEEDS_REMINDER_KIND = 'local_needs_reminder';

/** Days before the meeting the coordinator hears of an empty part. */
export const LOCAL_NEEDS_REMINDER_DAYS = [14, 7] as const;

const STR: Record<
  SupportedLanguage,
  { title: string; body: (day: string) => string }
> = {
  ru: {
    title: 'Местные потребности',
    body: (day) => `Тема на ${day} не выбрана`,
  },
  de: {
    title: 'Örtliche Bedürfnisse',
    body: (day) => `Für ${day} ist noch kein Thema gewählt`,
  },
  en: {
    title: 'Local needs',
    body: (day) => `No topic chosen yet for ${day}`,
  },
};

/**
 * «Местные потребности» without a topic — told to the body of elders'
 * coordinator, who answers for it, and to nobody else (Lionel, 28 October
 * 2026): 14 days before the meeting, and once more at 7. The text is the
 * date and nothing more.
 *
 * Each stage is said once per week — the key carries the stage, so the
 * second reminder is a new notice and a repeat of either is not. A first
 * run that finds the meeting already within seven days says only the
 * second one.
 */
@Injectable()
export class LocalNeedsRemindersService {
  private readonly logger = new Logger(LocalNeedsRemindersService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    private readonly localNeeds: LocalNeedsService,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  async runDaily(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.runFor(c.id);
      } catch (err) {
        this.logger.error(`local needs reminder ${c.id}: ${String(err)}`);
      }
    }
  }

  async runFor(tenantId: string): Promise<number> {
    const coordinators = await this.responsibilities.find({
      where: {
        congregationId: tenantId,
        type: ResponsibilityType.BODY_COORDINATOR,
      },
      select: { id: true, userId: true },
    });
    const userIds = [
      ...new Set(coordinators.map((r) => r.userId).filter(Boolean)),
    ];
    if (userIds.length === 0) return 0;

    const today = await this.clock.todayFor(tenantId);
    let said = 0;
    for (const w of await this.localNeeds.unfilledWeeks(tenantId)) {
      const day = w.meetingDate ?? w.weekStartDate;
      const left = daysBetween(today, day);
      if (left < 0) continue;
      // The nearest stage the meeting is within: 7, else 14.
      const stage = [...LOCAL_NEEDS_REMINDER_DAYS]
        .sort((a, b) => a - b)
        .find((d) => left <= d);
      if (stage === undefined) continue;
      await this.notifications.notify({
        tenantId,
        userIds,
        text: (l) => ({
          title: STR[l].title,
          body: STR[l].body(shortDay(day, l)),
        }),
        kind: LOCAL_NEEDS_REMINDER_KIND,
        key: `local-needs:${w.weekStartDate}:${stage}`,
        data: {
          type: 'local_needs_reminder',
          weekStartDate: w.weekStartDate,
        },
      });
      said++;
    }
    return said;
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
