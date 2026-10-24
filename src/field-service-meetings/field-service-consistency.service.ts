import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { FieldServiceSettings } from '../entities/field-service-settings.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { shortDay } from '../assignment-reminders/digest';
import { mondayOf } from '../common/week';
import {
  FieldServiceAttentionService,
  meetingDay,
  type MeetingProblem,
} from './field-service-attention.service';

/** How far ahead the meetings are looked at: two months of planning. */
const DAYS_AHEAD = 56;
/** The 7th day before a month: when its drafts were due to be announced. */
const PUBLISH_DAYS_BEFORE = 7;

/** What the check finds on one meeting. */
export type FieldServiceFindingKind = MeetingProblem | 'unpublished';

export interface FieldServiceFinding {
  meetingId: string;
  date: string;
  time: string;
  kinds: FieldServiceFindingKind[];
  conductor: string | null;
  because: string | null;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const STR: Record<
  SupportedLanguage,
  {
    title: (n: number) => string;
    kind: Record<
      FieldServiceFindingKind,
      (who: string | null, because: string | null) => string
    >;
    more: (n: number) => string;
  }
> = {
  ru: {
    title: (n) =>
      n === 1
        ? 'Встреча для проповеди: нужно поправить'
        : `Встречи для проповеди: нужно поправить — ${n}`,
    kind: {
      conductor_absent: (w) => `${w ?? 'ведущий'} в отъезде`,
      conductor_not_conductor: (w) => `${w ?? 'ведущий'} больше не проводит`,
      conductor_removed: () => 'ведущий выбыл из собрания',
      group_removed: () => 'группа удалена',
      assembly: (_w, b) => `в этот день ${b ?? 'конгресс'}`,
      co_visit: () => 'неделя посещения районного надзирателя',
      unpublished: () => 'ещё черновик',
    },
    more: (n) => `и ещё ${n}`,
  },
  de: {
    title: (n) =>
      n === 1
        ? 'Predigtdienstzusammenkunft: bitte korrigieren'
        : `Predigtdienstzusammenkünfte: bitte korrigieren — ${n}`,
    kind: {
      conductor_absent: (w) => `${w ?? 'Leiter'} ist abwesend`,
      conductor_not_conductor: (w) => `${w ?? 'Leiter'} leitet nicht mehr`,
      conductor_removed: () => 'Leiter ist nicht mehr in der Versammlung',
      group_removed: () => 'Gruppe gelöscht',
      assembly: (_w, b) => `an diesem Tag: ${b ?? 'Kongress'}`,
      co_visit: () => 'Woche des Kreisaufseherbesuchs',
      unpublished: () => 'noch Entwurf',
    },
    more: (n) => `und ${n} weitere`,
  },
  en: {
    title: (n) =>
      n === 1
        ? 'Field service meeting: needs fixing'
        : `Field service meetings: ${n} need fixing`,
    kind: {
      conductor_absent: (w) => `${w ?? 'the conductor'} is away`,
      conductor_not_conductor: (w) =>
        `${w ?? 'the conductor'} no longer conducts`,
      conductor_removed: () => 'the conductor has left the congregation',
      group_removed: () => 'the group was removed',
      assembly: (_w, b) => `that day: ${b ?? 'assembly'}`,
      co_visit: () => "the circuit overseer's week",
      unpublished: () => 'still a draft',
    },
    more: (n) => `and ${n} more`,
  },
};

/**
 * Every morning: are the field-service meetings ahead still what was
 * planned? (24 October 2026, after the talk journal's own check.)
 *
 * A meeting is planned once, and the world goes on: a vacation entered
 * after the month was prepared, a brother whose switch was turned off or
 * who left, a group removed, an assembly entered later, a draft that
 * nobody announced after its day came. Each is marked on the month view;
 * this tells the service overseer and his assistant, once per distinct set
 * of findings — the same list is not repeated every morning, a change in it
 * is told again.
 */
@Injectable()
export class FieldServiceConsistencyService {
  private readonly logger = new Logger(FieldServiceConsistencyService.name);

  constructor(
    @InjectRepository(FieldServiceMeeting)
    private readonly meetings: Repository<FieldServiceMeeting>,
    @InjectRepository(FieldServiceSettings)
    private readonly settings: Repository<FieldServiceSettings>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    private readonly attention: FieldServiceAttentionService,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  /** Each congregation that plans field service in the app. */
  async runDaily(): Promise<void> {
    const all = await this.settings.find({ select: { congregationId: true } });
    for (const s of all) {
      try {
        await this.runFor(s.congregationId);
      } catch (err) {
        this.logger.error(
          `field-service check ${s.congregationId}: ${String(err)}`,
        );
      }
    }
  }

  async runFor(congregationId: string): Promise<FieldServiceFinding[]> {
    const found = await this.findings(congregationId);
    if (found.length === 0) return found;
    const held = await this.responsibilities.find({
      where: {
        congregationId,
        type: In([
          ResponsibilityType.SERVICE_OVERSEER,
          ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
        ]),
      },
    });
    const userIds = [
      ...new Set(held.map((r) => r.userId).filter((x): x is string => !!x)),
    ];
    if (userIds.length === 0) return found;
    const digest = createHash('sha1')
      .update(
        found
          .map((f) => `${f.meetingId}|${f.kinds.join(',')}|${f.conductor}`)
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16);
    const first = found[0];
    await this.notifications.notify({
      tenantId: congregationId,
      userIds,
      kind: 'field_service_meeting',
      key: `field-service-check:${congregationId}:${digest}`,
      text: (l) => {
        const lines = found.slice(0, 4).map((f) => {
          const what = f.kinds
            .map((k) => STR[l].kind[k](f.conductor, f.because))
            .join('; ');
          return `${shortDay(f.date, l)}, ${f.time}: ${what}`;
        });
        if (found.length > 4) lines.push(STR[l].more(found.length - 4));
        return { title: STR[l].title(found.length), body: lines.join('\n') };
      },
      data: {
        type: 'field_service_meeting',
        meetingId: first.meetingId,
        date: first.date,
        month: first.date.slice(0, 7),
      },
    });
    return found;
  }

  /** The meetings ahead that need a person's hand, soonest first. */
  async findings(congregationId: string): Promise<FieldServiceFinding[]> {
    const today = await this.clock.todayFor(congregationId);
    const to = addDaysISO(today, DAYS_AHEAD);
    const rows = await this.meetings
      .createQueryBuilder('m')
      .where('m.congregationId = :congregationId', { congregationId })
      .andWhere('m.cancelledAt IS NULL')
      .andWhere('m.weekStartDate >= :from', { from: mondayOf(today) })
      .andWhere('m.weekStartDate <= :to', { to })
      .getMany();
    const ahead = rows.filter((m) => {
      const d = meetingDay(m);
      return d >= today && d <= to;
    });
    if (ahead.length === 0) return [];
    const marks = await this.attention.of(congregationId, ahead, today);
    const out: FieldServiceFinding[] = [];
    for (const m of ahead) {
      const d = meetingDay(m);
      const kinds: FieldServiceFindingKind[] = [
        ...(marks.get(m.id)?.problems ?? []),
      ];
      // A draft whose month was due to be announced and was not: the
      // conductor does not know (sync audit L5). Before that day a draft is
      // the overseer's work in progress and is not judged.
      const publishDay = addDaysISO(
        `${d.slice(0, 7)}-01`,
        -PUBLISH_DAYS_BEFORE,
      );
      if (m.publishedAt === null && today >= publishDay)
        kinds.push('unpublished');
      if (kinds.length === 0) continue;
      out.push({
        meetingId: m.id,
        date: d,
        time: m.startTime,
        kinds,
        conductor: marks.get(m.id)?.conductorName ?? null,
        because: marks.get(m.id)?.because ?? null,
      });
    }
    out.sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
    return out;
  }
}
