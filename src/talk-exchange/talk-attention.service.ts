import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Absence } from '../entities/absence.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { Congregation } from '../entities/congregation.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { SupportedLanguage } from '../common/i18n/supported-languages';
import { shortDay } from '../assignment-reminders/digest';
import { addDaysISO } from '../common/week-rules';

/** The kind these notices go out under; «other» — they cannot be switched off. */
export const TALK_ATTENTION_KIND = 'talk_exchange_attention';

/** Why a trip of ours needs somebody's attention. */
export type AttentionReason = 'needs_brother' | 'absence' | 'departed';

export interface AttentionItem {
  id: string;
  date: string;
  reason: AttentionReason;
  hostCongregationId: string | null;
  publisherId: string | null;
}

/**
 * Who answers for the exchange of talks (Lionel, 23 October 2026): the
 * coordinator of the body of elders — he answers for it — the public talk
 * coordinator, who does it for him, with his assistant, and the
 * administrators. Not the body coordinator's assistant: «не всегда помощник
 * координатора занимается этими делами».
 */
const ANSWERING: ResponsibilityType[] = [
  ResponsibilityType.BODY_COORDINATOR,
  ResponsibilityType.PUBLIC_TALK_COORDINATOR,
  ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
];

/** Reminders while nobody is named, days before the trip (Lionel: 14 and 7). */
const NEEDS_BROTHER_DAYS = [14, 7] as const;

const STR: Record<
  SupportedLanguage,
  {
    needsTitle: string;
    needsBody: (day: string, host: string) => string;
    soonTitle: (days: number) => string;
    riskTitle: string;
    absence: (day: string, host: string) => string;
    departed: (day: string, host: string) => string;
    elsewhere: string;
    cancelledTitle: string;
    cancelledBody: (day: string, guest: string) => string;
    droppedTitle: string;
    droppedBody: (day: string, guest: string) => string;
    guest: string;
  }
> = {
  ru: {
    needsTitle: 'От нас нужен брат',
    needsBody: (day, host) => `${day} · ${host} ждёт докладчика от нас`,
    soonTitle: (d) => `Через ${d} дней — от нас нужен брат`,
    riskTitle: 'Поездка под вопросом',
    absence: (day, host) =>
      `${day} · ${host}: у брата в этот день отсутствие. Уточните, поедет ли он`,
    departed: (day, host) =>
      `${day} · ${host}: брат отмечен выбывшим. Нужен другой`,
    elsewhere: 'другое собрание',
    cancelledTitle: 'Встреча отменена — у нас записан гость',
    cancelledBody: (day, guest) =>
      `${day} · ${guest}. Сообщите ему или перенесите визит`,
    droppedTitle: 'Докладчика убрали из программы',
    droppedBody: (day, guest) =>
      `${day} · ${guest} записан в журнале «К нам», а в программе его больше нет. Проверьте, приедет ли он`,
    guest: 'гость',
  },
  de: {
    needsTitle: 'Ein Bruder von uns wird gebraucht',
    needsBody: (day, host) => `${day} · ${host} erwartet einen Redner von uns`,
    soonTitle: (d) => `In ${d} Tagen – ein Bruder von uns wird gebraucht`,
    riskTitle: 'Vortragsreise fraglich',
    absence: (day, host) =>
      `${day} · ${host}: Der Bruder ist an diesem Tag abwesend. Bitte klären, ob er fährt`,
    departed: (day, host) =>
      `${day} · ${host}: Der Bruder ist als ausgeschieden markiert. Ein anderer wird gebraucht`,
    elsewhere: 'andere Versammlung',
    cancelledTitle: 'Zusammenkunft abgesagt – ein Gastredner ist eingetragen',
    cancelledBody: (day, guest) =>
      `${day} · ${guest}. Bitte ihn informieren oder den Besuch verschieben`,
    droppedTitle: 'Redner aus dem Programm entfernt',
    droppedBody: (day, guest) =>
      `${day} · ${guest} steht im Vortragsplan, aber nicht mehr im Programm. Bitte klären, ob er kommt`,
    guest: 'Gastredner',
  },
  en: {
    needsTitle: 'A brother from us is needed',
    needsBody: (day, host) => `${day} · ${host} expects a speaker from us`,
    soonTitle: (d) => `In ${d} days — a brother from us is needed`,
    riskTitle: 'Talk trip in question',
    absence: (day, host) =>
      `${day} · ${host}: the brother is away that day. Check whether he is going`,
    departed: (day, host) =>
      `${day} · ${host}: the brother is marked as departed. Someone else is needed`,
    elsewhere: 'another congregation',
    cancelledTitle: 'Meeting cancelled — a guest speaker is booked',
    cancelledBody: (day, guest) =>
      `${day} · ${guest}. Let him know or move the visit`,
    droppedTitle: 'Speaker removed from the programme',
    droppedBody: (day, guest) =>
      `${day} · ${guest} is booked in the talk log but no longer in the programme. Check whether he is coming`,
    guest: 'guest',
  },
};

/**
 * A trip of ours is a promise to another congregation (23 October 2026).
 *
 * Lionel: if the brother who was to go is taken off, «то собрание будет
 * ждать докладчика с нашего собрания». The entry used to be deleted with
 * him and the promise vanished without a word. Now a trip without a brother
 * stays, is listed as needing one, and those who answer for the exchange
 * are told — when he is taken off, and again 14 and 7 days before. A trip
 * whose brother is away that day or has left is marked «in question» the
 * same way, until someone says he goes.
 */
@Injectable()
export class TalkAttentionService {
  private readonly logger = new Logger(TalkAttentionService.name);

  constructor(
    @InjectRepository(TalkExchange)
    private readonly entries: Repository<TalkExchange>,
    @InjectRepository(Absence)
    private readonly absences: Repository<Absence>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ExternalCongregation)
    private readonly hosts: Repository<ExternalCongregation>,
    private readonly notifications: NotificationsService,
    private readonly clock: CongregationClock,
  ) {}

  /** The congregation's own day, never the server's. */
  private today(tenantId: string): Promise<string> {
    return this.clock.todayFor(tenantId);
  }

  /** Active sign-ins of those who answer for the exchange, and the admins. */
  async recipients(tenantId: string): Promise<string[]> {
    const held = await this.responsibilities.find({
      where: { congregationId: tenantId, type: In(ANSWERING) },
      select: { userId: true },
    });
    const admins = await this.users.find({
      where: { congregationId: tenantId, role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    const ids = [
      ...new Set([...held.map((r) => r.userId), ...admins.map((u) => u.id)]),
    ];
    if (ids.length === 0) return [];
    const active = await this.users.find({
      where: { id: In(ids), congregationId: tenantId, isActive: true },
      select: { id: true },
    });
    return active.map((u) => u.id);
  }

  /** Our trips from today on that need someone, with the reason. */
  async attentionFor(
    tenantId: string,
    horizonDays = 366,
  ): Promise<AttentionItem[]> {
    const today = await this.today(tenantId);
    const until = addDaysISO(today, horizonDays);
    const trips = await this.entries.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.OUTGOING,
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        date: Between(today, until),
      },
      order: { date: 'ASC' },
    });
    if (trips.length === 0) return [];
    const brothers = [
      ...new Set(
        trips.map((t) => t.publisherId).filter((x): x is string => !!x),
      ),
    ];
    const cards = brothers.length
      ? await this.publishers.find({
          where: { id: In(brothers), congregationId: tenantId },
          withDeleted: true,
          select: { id: true, deletedAt: true },
        })
      : [];
    const departed = new Set(cards.filter((c) => c.deletedAt).map((c) => c.id));
    const away = brothers.length
      ? await this.absences.find({
          where: { congregationId: tenantId, publisherId: In(brothers) },
        })
      : [];

    const tripAbsences = new Set(
      trips.map((t) => t.linkedAbsenceId).filter((x): x is string => !!x),
    );
    const out: AttentionItem[] = [];
    for (const t of trips) {
      const date = String(t.date).slice(0, 10);
      const base = {
        id: t.id,
        date,
        hostCongregationId: t.hostCongregationId ?? null,
        publisherId: t.publisherId ?? null,
      };
      if (!t.publisherId) {
        out.push({ ...base, reason: 'needs_brother' });
        continue;
      }
      let reason: AttentionReason | null = null;
      if (departed.has(t.publisherId)) reason = 'departed';
      else if (
        away.some(
          (a) =>
            a.publisherId === t.publisherId &&
            // An absence a trip wrote says he is away GIVING a talk — his own
            // trip, or another the same day. Two talks in one day are a
            // legitimate pair (Lionel, 11 September 2026), so neither puts the
            // other in question. Found on 23 October: a brother with two trips
            // on the 25th had both marked, each by the other's absence.
            !a.talkExchangeId &&
            !tripAbsences.has(a.id) &&
            a.startDate.slice(0, 10) <= date &&
            (a.endDate ? a.endDate.slice(0, 10) : a.startDate.slice(0, 10)) >=
              date,
        )
      )
        reason = 'absence';
      if (reason && t.riskAckReason !== reason) out.push({ ...base, reason });
    }
    return out;
  }

  /** «He goes»: the mark for this reason is lifted until something changes. */
  async acknowledge(
    tenantId: string,
    id: string,
    reason: AttentionReason,
  ): Promise<void> {
    await this.entries.update(
      { id, congregationId: tenantId },
      { riskAckReason: reason },
    );
  }

  /**
   * Said when the brother is taken off a trip that still stands. Called by
   * the journal after the entry is saved.
   */
  async brotherTakenOff(
    tenantId: string,
    entry: Pick<TalkExchange, 'id' | 'date' | 'hostCongregationId'>,
  ): Promise<void> {
    try {
      const date = String(entry.date).slice(0, 10);
      if (date < (await this.today(tenantId))) return;
      const host = await this.hostName(tenantId, entry.hostCongregationId);
      const stamp = Math.floor(Date.now() / 10_000).toString(36);
      await this.say(
        tenantId,
        entry.id,
        date,
        (l) => ({
          title: STR[l].needsTitle,
          body: STR[l].needsBody(shortDay(date, l), host ?? STR[l].elsewhere),
        }),
        `talk-attention:off:${entry.id}:${stamp}`,
      );
    } catch (err) {
      this.logger.warn(
        `talk attention ${entry.id}: not announced: ${(err as Error).message}`,
      );
    }
  }

  /**
   * A guest is booked for a weekend whose meeting was just cancelled — a
   * convention, the circuit assembly. His entry is kept; the brother himself
   * must be told, and only those who answer for the talks can (23 October
   * 2026). Once per cancellation of that entry.
   */
  async meetingCancelled(
    tenantId: string,
    entry: Pick<TalkExchange, 'id' | 'date' | 'speakerName'>,
  ): Promise<void> {
    await this.aboutGuest(tenantId, entry, 'cancelled');
  }

  /**
   * The weekend programme no longer names a guest the coordinator booked:
   * the entry is his arrangement and stays, but the chairman would announce
   * nobody (23 October 2026).
   */
  async droppedFromProgramme(
    tenantId: string,
    entry: Pick<TalkExchange, 'id' | 'date' | 'speakerName'>,
  ): Promise<void> {
    await this.aboutGuest(tenantId, entry, 'dropped');
  }

  private async aboutGuest(
    tenantId: string,
    entry: Pick<TalkExchange, 'id' | 'date' | 'speakerName'>,
    what: 'cancelled' | 'dropped',
  ): Promise<void> {
    try {
      const date = String(entry.date).slice(0, 10);
      if (date < (await this.today(tenantId))) return;
      const stamp = Math.floor(Date.now() / 10_000).toString(36);
      await this.say(
        tenantId,
        entry.id,
        date,
        (l) => ({
          title:
            what === 'cancelled' ? STR[l].cancelledTitle : STR[l].droppedTitle,
          body: (what === 'cancelled'
            ? STR[l].cancelledBody
            : STR[l].droppedBody)(
            shortDay(date, l),
            entry.speakerName?.trim() || STR[l].guest,
          ),
        }),
        `talk-attention:${what}:${entry.id}:${stamp}`,
      );
    } catch (err) {
      this.logger.warn(
        `talk attention ${entry.id}: not announced: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Once a day: the reminders 14 and 7 days before a trip still without a
   * brother, and one notice per trip that has come into question. Every
   * notice carries a key, so a second pass the same day says nothing, and a
   * night the server was down is caught up the next. Scheduled from
   * scheduled-jobs, where every timed job lives.
   */
  async runDaily(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.runFor(c.id);
      } catch (err) {
        this.logger.error(`talk attention ${c.id}: ${String(err)}`);
      }
    }
  }

  async runFor(tenantId: string): Promise<number> {
    const today = await this.today(tenantId);
    const items = await this.attentionFor(tenantId, NEEDS_BROTHER_DAYS[0]);
    let said = 0;
    for (const it of items) {
      const host =
        (await this.hostName(tenantId, it.hostCongregationId)) ?? null;
      if (it.reason === 'needs_brother') {
        const days = daysBetween(today, it.date);
        // The nearest threshold already reached: a trip entered 10 days
        // ahead gets the 14-day notice now, and the 7-day one later.
        const due = [...NEEDS_BROTHER_DAYS].reverse().find((d) => days <= d);
        if (due === undefined) continue;
        await this.say(
          tenantId,
          it.id,
          it.date,
          (l) => ({
            title: STR[l].soonTitle(days),
            body: STR[l].needsBody(
              shortDay(it.date, l),
              host ?? STR[l].elsewhere,
            ),
          }),
          `talk-attention:need:${it.id}:${due}`,
        );
        said++;
      } else {
        await this.say(
          tenantId,
          it.id,
          it.date,
          (l) => ({
            title: STR[l].riskTitle,
            body: STR[l][it.reason as 'absence' | 'departed'](
              shortDay(it.date, l),
              host ?? STR[l].elsewhere,
            ),
          }),
          `talk-attention:risk:${it.id}:${it.reason}:${it.publisherId}`,
        );
        said++;
      }
    }
    return said;
  }

  private async hostName(
    tenantId: string,
    id: string | null | undefined,
  ): Promise<string | null> {
    if (!id) return null;
    const h = await this.hosts.findOne({
      where: { id, congregationId: tenantId },
    });
    return h?.name ?? null;
  }

  private async say(
    tenantId: string,
    entryId: string,
    date: string,
    text: (l: SupportedLanguage) => { title: string; body: string },
    key: string,
  ): Promise<void> {
    const userIds = await this.recipients(tenantId);
    if (userIds.length === 0) return;
    await this.notifications.notify({
      tenantId,
      userIds,
      text,
      kind: TALK_ATTENTION_KIND,
      key,
      data: { type: 'talk_exchange_attention', entryId, date },
    });
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
