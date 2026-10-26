import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Absence } from '../entities/absence.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { Congregation } from '../entities/congregation.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { SpecialEvent } from '../entities/special-event.entity';
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
import { mondayOf } from '../common/week';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  WeekRulesService,
  rulesFromContext,
} from '../common/week-rules.service';
import { weekSongs } from './week-songs';

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

/** A guest set aside by a visit is mentioned once more after these days. */
const ASIDE_AGAIN_DAYS = 3;

/**
 * Our own weekends (Lionel, 25–26 October 2026). The «Внимание» list shows a
 * weekend nobody is booked for from 8 weeks ahead, a visit without its talk
 * from 4, a guest's unknown song and the missing lunch bag from 2. All of
 * these are counted into the weekly summary; only a guest's opening song
 * that the Watchtower study sings the same day is said at once.
 */
const NEEDS_GUEST_DAYS = [56, 28] as const;
/** A visit's talk is asked for from 4 weeks before, the guest's song from 2. */
const NEEDS_TALK_DAYS = 28;
const NEEDS_SONG_DAYS = 14;
const LUNCH_LIST_DAYS = 14;
/** The lunch bag's bringer hears of it this many days before, at evening. */
export const LUNCH_BAG_EVENING_DAYS = 2;

/** Why one of our weekends needs somebody's attention. */
export type IncomingReason =
  | 'needs_guest'
  | 'no_lunch'
  | 'song_repeat'
  /** A visit without its talk, 4 weeks before (26 October 2026). */
  | 'needs_talk'
  /** A guest's opening song not known, 2 weeks before. */
  | 'needs_song';

export interface IncomingAttentionItem {
  reason: IncomingReason;
  weekStartDate: string;
  /** The weekend meeting's day. */
  date: string;
  /** The week's visit, when there is one. */
  entryId: string | null;
  /** The guest's name, when known. */
  guest: string | null;
  /** The opening song that repeats (song_repeat). */
  song: number | null;
  /** The Watchtower study's songs that weekend (song_repeat). */
  studySongs: number[];
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const IN_STR: Record<
  SupportedLanguage,
  {
    songTitle: string;
    songBody: (day: string, guest: string, song: number) => string;
    bagTitle: string;
    bagBody: (day: string, guest: string) => string;
    theGuest: string;
    digestTitle: (n: number) => string;
    digestRemindTitle: string;
    dEmpty: (n: number) => string;
    dTalk: (n: number) => string;
    dSong: (n: number) => string;
    dLunch: (n: number) => string;
    dTrips: (n: number) => string;
    dRemind: (day: string, guest: string) => string;
  }
> = {
  ru: {
    songTitle: 'Песня гостя повторяется',
    songBody: (day, g, n) =>
      `${day} · ${g}: песня ${n} поётся на изучении «Сторожевой башни». Попросите выбрать другую`,
    bagTitle: 'Ланч-пакет для докладчика',
    bagBody: (day, g) =>
      `${day}: принесите, пожалуйста, ланч-пакет для брата ${g} в Зал Царства`,
    theGuest: 'гость',
    digestTitle: (n) => `По речам — ${n} ${ruPlural(n, 'дело', 'дела', 'дел')}`,
    digestRemindTitle: 'По речам на этой неделе',
    dEmpty: (n) => `Пустые недели «К нам»: ${n}`,
    dTalk: (n) => `Речь не выбрана: ${n}`,
    dSong: (n) => `Песня гостя не известна: ${n}`,
    dLunch: (n) => `Ланч-пакет никто не несёт: ${n}`,
    dTrips: (n) => `Поездки «От нас» без брата: ${n}`,
    dRemind: (day, g) => `Напомнить гостю: ${day} · ${g}`,
  },
  de: {
    songTitle: 'Lied des Gastredners doppelt',
    songBody: (day, g, n) =>
      `${day} · ${g}: Lied ${n} wird beim Wachtturm-Studium gesungen. Bitte um ein anderes bitten`,
    bagTitle: 'Lunchpaket für den Redner',
    bagBody: (day, g) =>
      `${day}: Bitte bringen Sie ein Lunchpaket für Bruder ${g} in den Königreichssaal`,
    theGuest: 'Gastredner',
    digestTitle: (n) => `Vorträge — ${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'}`,
    digestRemindTitle: 'Vorträge diese Woche',
    dEmpty: (n) => `Leere Wochen ohne Gastredner: ${n}`,
    dTalk: (n) => `Kein Vortrag gewählt: ${n}`,
    dSong: (n) => `Lied des Gastredners unbekannt: ${n}`,
    dLunch: (n) => `Niemand bringt ein Lunchpaket: ${n}`,
    dTrips: (n) => `Vortragsreisen ohne Bruder: ${n}`,
    dRemind: (day, g) => `Gastredner erinnern: ${day} · ${g}`,
  },
  en: {
    songTitle: "The guest's song repeats",
    songBody: (day, g, n) =>
      `${day} · ${g}: song ${n} is sung at the Watchtower study. Ask him to choose another`,
    bagTitle: 'A lunch bag for the speaker',
    bagBody: (day, g) =>
      `${day}: please bring a lunch bag for Brother ${g} to the Kingdom Hall`,
    theGuest: 'guest',
    digestTitle: (n) => `Talks — ${n} ${n === 1 ? 'thing' : 'things'} to do`,
    digestRemindTitle: 'Talks this week',
    dEmpty: (n) => `Empty weekends: ${n}`,
    dTalk: (n) => `No talk chosen: ${n}`,
    dSong: (n) => `Guest's song not known: ${n}`,
    dLunch: (n) => `Nobody brings a lunch bag: ${n}`,
    dTrips: (n) => `Trips without a brother: ${n}`,
    dRemind: (day, g) => `Remind the guest: ${day} · ${g}`,
  },
};

const STR: Record<
  SupportedLanguage,
  {
    needsTitle: string;
    needsBody: (day: string, host: string) => string;
    riskTitle: string;
    absence: (day: string, host: string) => string;
    departed: (day: string, host: string) => string;
    elsewhere: string;
    cancelledTitle: string;
    cancelledBody: (day: string, guest: string) => string;
    droppedTitle: string;
    droppedBody: (day: string, guest: string) => string;
    asideTitle: string;
    asideBody: (day: string, guest: string) => string;
    asideAgainTitle: string;
    asideAgainBody: (day: string, guest: string) => string;
    guest: string;
  }
> = {
  ru: {
    needsTitle: 'От нас нужен брат',
    needsBody: (day, host) => `${day} · ${host} ждёт докладчика от нас`,
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
    asideTitle: 'Визит районного занял неделю гостя',
    asideBody: (day, guest) =>
      `${day} выступит районный. ${guest} отложен — предупредите его или перенесите`,
    asideAgainTitle: 'Гость всё ещё отложен',
    asideAgainBody: (day, guest) =>
      `${day} · ${guest} отложен из‑за визита районного и не перенесён. Предупредите его или перенесите`,
    guest: 'гость',
  },
  de: {
    needsTitle: 'Ein Bruder von uns wird gebraucht',
    needsBody: (day, host) => `${day} · ${host} erwartet einen Redner von uns`,
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
    asideTitle: 'Der Kreisaufseherbesuch belegt die Woche eines Gastredners',
    asideBody: (day, guest) =>
      `${day} spricht der Kreisaufseher. ${guest} ist zurückgestellt – bitte ihn informieren oder verlegen`,
    asideAgainTitle: 'Gastredner noch zurückgestellt',
    asideAgainBody: (day, guest) =>
      `${day} · ${guest} ist wegen des Kreisaufseherbesuchs zurückgestellt und nicht verlegt. Bitte ihn informieren oder verlegen`,
    guest: 'Gastredner',
  },
  en: {
    needsTitle: 'A brother from us is needed',
    needsBody: (day, host) => `${day} · ${host} expects a speaker from us`,
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
    asideTitle: "The circuit overseer's visit took a guest's week",
    asideBody: (day, guest) =>
      `${day} the circuit overseer speaks. ${guest} is set aside — let him know or move him`,
    asideAgainTitle: 'A guest is still set aside',
    asideAgainBody: (day, guest) =>
      `${day} · ${guest} is set aside for the circuit overseer's visit and not moved. Let him know or move him`,
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
    @InjectRepository(VisitingSpeaker)
    private readonly speakers: Repository<VisitingSpeaker>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    private readonly weekRules: WeekRulesService,
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

  /**
   * Our own weekends that need somebody (25 October 2026): nobody booked,
   * no lunch bag for the guest, his opening song sung at the study. Only
   * weekends the congregation meets on, never a circuit visit's: the
   * overseer's week has its own songs and its own hospitality. `onlyWeek`
   * asks about one week, for the check right after a change.
   */
  async incomingAttention(
    tenantId: string,
    onlyWeek?: string,
  ): Promise<IncomingAttentionItem[]> {
    const today = await this.today(tenantId);
    const first = onlyWeek ?? mondayOf(today);
    const last = onlyWeek ?? addDaysISO(mondayOf(today), 52 * 7);
    const weeks: string[] = [];
    for (let w = first; w <= last; w = addDaysISO(w, 7)) weeks.push(w);
    const [ctx, entries, slots, songs] = await Promise.all([
      this.weekRules.contextOf(tenantId),
      this.entries.find({
        where: {
          congregationId: tenantId,
          direction: TalkExchangeDirection.INCOMING,
          status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
          date: Between(first, addDaysISO(last, 6)),
        },
        order: { date: 'ASC' },
      }),
      this.assignments.find({
        where: {
          congregationId: tenantId,
          partKey: 'public_talk_speaker',
          weekStartDate: Between(first, last),
        },
        select: {
          id: true,
          weekStartDate: true,
          publisherId: true,
          speakerName: true,
          status: true,
        },
      }),
      weekSongs(this.assignments, tenantId, weeks),
    ]);
    const entryOf = new Map<string, TalkExchange>();
    for (const e of entries) {
      const w = mondayOf(String(e.date));
      if (!entryOf.has(w)) entryOf.set(w, e);
    }
    const slotOf = new Map(
      slots.map((a) => [String(a.weekStartDate).slice(0, 10), a]),
    );
    const out: IncomingAttentionItem[] = [];
    for (const week of weeks) {
      const rules = rulesFromContext(ctx, week);
      if (!rules.meetingsHeld || rules.coVisit) continue;
      if (rules.memorialTakes === 'weekend') continue;
      if (rules.replacedBy('weekend')) continue;
      // No settings recorded yet: Sunday, as the journal dates its visits.
      const date = rules.dateOf('weekend') ?? addDaysISO(week, 6);
      if (date < today) continue;
      const days = daysBetween(today, date);
      const entry = entryOf.get(week) ?? null;
      const slot = slotOf.get(week) ?? null;
      if (slot?.status === AssignmentStatus.CANCELLED) continue;
      if (entry?.meetingCancelled) continue;
      const base = {
        weekStartDate: week,
        date,
        entryId: entry?.id ?? null,
        guest: null as string | null,
        song: null as number | null,
        studySongs: [] as number[],
      };
      if (!entry) {
        const booked = !!(slot?.publisherId || slot?.speakerName?.trim());
        if (!booked && days <= NEEDS_GUEST_DAYS[0]) {
          out.push({ ...base, reason: 'needs_guest' });
        }
      }
      const guestVisit = !!entry && !entry.publisherId && !entry.circuitVisitId;
      const noLunch =
        guestVisit && !entry.hospitalityPublisherId && days <= LUNCH_LIST_DAYS;
      const ws = songs.get(week);
      const opening = ws?.opening ?? entry?.openingSong ?? null;
      const repeats = opening !== null && !!ws && ws.study.includes(opening);
      const guest =
        entry && (noLunch || repeats)
          ? await this.guestName(tenantId, entry)
          : null;
      if (noLunch) out.push({ ...base, guest, reason: 'no_lunch' });
      // Arranged in a hurry, completed later (26 October 2026): what the
      // visit still lacks is asked for in good time.
      const lacksTalk =
        !!entry && !entry.publicTalkId && !entry.specialTheme?.trim();
      if (lacksTalk && days <= NEEDS_TALK_DAYS) {
        out.push({
          ...base,
          guest: guest ?? (await this.guestName(tenantId, entry)),
          reason: 'needs_talk',
        });
      }
      if (guestVisit && opening === null && days <= NEEDS_SONG_DAYS) {
        out.push({
          ...base,
          guest: guest ?? (await this.guestName(tenantId, entry)),
          reason: 'needs_song',
        });
      }
      if (repeats && ws) {
        out.push({
          ...base,
          guest,
          reason: 'song_repeat',
          song: opening,
          studySongs: ws.study,
        });
      }
    }
    return out;
  }

  /** The weekend songs of the weeks ahead that the programme holds. */
  async weekSongsAhead(
    tenantId: string,
  ): Promise<
    { weekStartDate: string; opening: number | null; study: number[] }[]
  > {
    const first = mondayOf(await this.today(tenantId));
    const weeks: string[] = [];
    for (let i = 0; i <= 52; i++) weeks.push(addDaysISO(first, i * 7));
    const map = await weekSongs(this.assignments, tenantId, weeks);
    return [...map.entries()]
      .filter(([, w]) => w.study.length > 0 || w.opening !== null)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([weekStartDate, w]) => ({ weekStartDate, ...w }));
  }

  /**
   * Right after a song or a programme changed: the coordinator hears at once
   * that the guest's song is the study's. Once per week and song.
   */
  async songCheck(tenantId: string, week: string): Promise<void> {
    try {
      const items = await this.incomingAttention(tenantId, week);
      for (const it of items) {
        if (it.reason === 'song_repeat') await this.sayIncoming(tenantId, it);
      }
    } catch (err) {
      this.logger.warn(
        `talk attention song ${week}: not checked: ${(err as Error).message}`,
      );
    }
  }

  /** A guest's song the study sings: said once per week and song. */
  private async sayIncoming(
    tenantId: string,
    it: IncomingAttentionItem,
  ): Promise<void> {
    const id = it.entryId ?? it.weekStartDate;
    await this.say(
      tenantId,
      id,
      it.date,
      (l) => ({
        title: IN_STR[l].songTitle,
        body: IN_STR[l].songBody(
          shortDay(it.date, l),
          it.guest ?? IN_STR[l].theGuest,
          it.song!,
        ),
      }),
      `talk-attention:song:${it.weekStartDate}:${it.song}`,
    );
  }

  /**
   * The week's things to do, in ONE notice (Lionel, 26 October 2026).
   *
   * Each kind used to have its own notice — empty weekends at 8 and 4 weeks,
   * the lunch bag at 7 days, «remind the guest» at 3, a trip without a
   * brother at 14 and 7 — and a coordinator receiving five kinds of them
   * stops reading. Now they are counted into one summary, once a week, the
   * first morning of the week the daily pass runs; a tap opens «Внимание».
   * What cannot wait is still said at once: a guest's song that the study
   * sings, a cancelled meeting with a guest, a visit that set a guest aside,
   * a trip whose brother came into question.
   */
  private async weeklyDigest(
    tenantId: string,
    today: string,
    tripsWithoutBrother: number,
  ): Promise<number> {
    const items = await this.incomingAttention(tenantId);
    const count = (r: IncomingReason) =>
      items.filter((i) => i.reason === r).length;
    const week = mondayOf(today);
    // This week's guests — those to remind of their talk.
    const soon = await this.entries.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        publisherId: IsNull(),
        circuitVisitId: IsNull(),
        meetingCancelled: false,
        date: Between(today, addDaysISO(week, 6)),
      },
      order: { date: 'ASC' },
    });
    const remind: { date: string; guest: string }[] = [];
    for (const e of soon) {
      const guest = await this.guestName(tenantId, e);
      if (guest) remind.push({ date: String(e.date).slice(0, 10), guest });
    }
    const counts = {
      empty: count('needs_guest'),
      talk: count('needs_talk'),
      song: count('needs_song'),
      lunch: count('no_lunch'),
      trips: tripsWithoutBrother,
    };
    const total =
      counts.empty + counts.talk + counts.song + counts.lunch + counts.trips;
    if (total === 0 && remind.length === 0) return 0;
    await this.say(
      tenantId,
      week,
      today,
      (l) => ({
        title:
          total > 0
            ? IN_STR[l].digestTitle(total)
            : IN_STR[l].digestRemindTitle,
        body: [
          counts.empty && IN_STR[l].dEmpty(counts.empty),
          counts.talk && IN_STR[l].dTalk(counts.talk),
          counts.song && IN_STR[l].dSong(counts.song),
          counts.lunch && IN_STR[l].dLunch(counts.lunch),
          counts.trips && IN_STR[l].dTrips(counts.trips),
          ...remind.map((r) => IN_STR[l].dRemind(shortDay(r.date, l), r.guest)),
        ]
          .filter(Boolean)
          .join('\n'),
      }),
      `talk-attention:digest:${week}`,
      { view: 'attention' },
    );
    return 1;
  }

  /**
   * The evening two days before the meeting (Friday for a Sunday — Lionel,
   * 25 October 2026): whoever brings the guest's lunch bag hears of it
   * himself, when he signs in to the app. Scheduled from scheduled-jobs.
   */
  async runLunchBagEvening(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.lunchBagFor(c.id);
      } catch (err) {
        this.logger.error(`lunch bag ${c.id}: ${String(err)}`);
      }
    }
  }

  async lunchBagFor(tenantId: string): Promise<number> {
    const today = await this.today(tenantId);
    const day = addDaysISO(today, LUNCH_BAG_EVENING_DAYS);
    const visits = await this.entries.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
        hospitalityPublisherId: Not(IsNull()),
        meetingCancelled: false,
        date: day,
      },
    });
    let said = 0;
    for (const e of visits) {
      const bringer = await this.publishers.findOne({
        where: { id: e.hospitalityPublisherId!, congregationId: tenantId },
        select: { id: true, userId: true },
      });
      if (!bringer?.userId) continue;
      const user = await this.users.findOne({
        where: { id: bringer.userId, congregationId: tenantId, isActive: true },
        select: { id: true },
      });
      if (!user) continue;
      const guest = await this.guestName(tenantId, e);
      await this.notifications.notify({
        tenantId,
        userIds: [user.id],
        text: (l) => ({
          title: IN_STR[l].bagTitle,
          body: IN_STR[l].bagBody(
            shortDay(day, l),
            guest ?? IN_STR[l].theGuest,
          ),
        }),
        kind: 'guest_lunch',
        key: `guest-lunch:${e.id}:${day}:${bringer.id}`,
        data: { type: 'assignment_reminder', date: day },
      });
      said++;
    }
    return said;
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

  /**
   * A circuit visit set a guest aside (25 October 2026): he may still be on
   * his way, and only those who answer for the talks can tell him. Once when
   * it happens, and once more after three days while he is neither moved nor
   * given back — see {@link runFor}.
   */
  async guestSetAside(
    tenantId: string,
    entry: Pick<TalkExchange, 'id' | 'date' | 'speakerName'>,
  ): Promise<void> {
    try {
      const date = String(entry.date).slice(0, 10);
      if (date < (await this.today(tenantId))) return;
      const guest = await this.guestName(tenantId, entry);
      await this.say(
        tenantId,
        entry.id,
        date,
        (l) => ({
          title: STR[l].asideTitle,
          body: STR[l].asideBody(shortDay(date, l), guest ?? STR[l].guest),
        }),
        `talk-attention:aside:${entry.id}`,
      );
    } catch (err) {
      this.logger.warn(
        `talk attention ${entry.id}: not announced: ${(err as Error).message}`,
      );
    }
  }

  /** The guest's name: written on the entry, or his card's. */
  private async guestName(
    tenantId: string,
    entry: Pick<TalkExchange, 'speakerName'> & {
      visitingSpeakerId?: string | null;
    },
  ): Promise<string | null> {
    if (entry.speakerName?.trim()) return entry.speakerName.trim();
    if (!entry.visitingSpeakerId) return null;
    const card = await this.speakers.findOne({
      where: { id: entry.visitingSpeakerId, congregationId: tenantId },
      withDeleted: true,
    });
    return card
      ? [card.firstName, card.lastName].filter(Boolean).join(' ') || null
      : null;
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
   * Once a day: one notice per trip that has come into question, a guest's
   * song the study sings, and once a week the summary of what is still to
   * do (26 October 2026). Every
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
    // A trip without a brother within 14 days: counted into the week's
    // summary (26 October 2026), no longer a notice of its own.
    let tripsWithoutBrother = 0;
    for (const it of items) {
      const host =
        (await this.hostName(tenantId, it.hostCongregationId)) ?? null;
      if (it.reason === 'needs_brother') {
        tripsWithoutBrother++;
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
    // A guest still set aside three days after the visit took his week.
    const aside = await this.entries.find({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        setAsideBy: Not(IsNull()),
        date: MoreThanOrEqual(today),
        deletedAt: Not(IsNull()),
      },
      withDeleted: true,
    });
    const standing = aside.length
      ? new Set(
          (
            await this.events.find({
              where: {
                congregationId: tenantId,
                id: In([...new Set(aside.map((e) => e.setAsideBy!))]),
              },
              select: { id: true },
            })
          ).map((v) => v.id),
        )
      : new Set<string>();
    const cutoff = Date.now() - ASIDE_AGAIN_DAYS * 86_400_000;
    for (const e of aside) {
      if (!standing.has(e.setAsideBy!)) continue;
      if (!e.deletedAt || +e.deletedAt > cutoff) continue;
      const date = String(e.date).slice(0, 10);
      const guest = await this.guestName(tenantId, e);
      await this.say(
        tenantId,
        e.id,
        date,
        (l) => ({
          title: STR[l].asideAgainTitle,
          body: STR[l].asideAgainBody(shortDay(date, l), guest ?? STR[l].guest),
        }),
        `talk-attention:aside-again:${e.id}`,
      );
      said++;
    }
    // At once: a guest's song the study sings that day.
    for (const it of await this.incomingAttention(tenantId)) {
      if (it.reason !== 'song_repeat') continue;
      await this.sayIncoming(tenantId, it);
      said++;
    }
    said += await this.weeklyDigest(tenantId, today, tripsWithoutBrother);
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
    extra: Record<string, string> = {},
  ): Promise<void> {
    const userIds = await this.recipients(tenantId);
    if (userIds.length === 0) return;
    await this.notifications.notify({
      tenantId,
      userIds,
      text,
      kind: TALK_ATTENTION_KIND,
      key,
      data: { type: 'talk_exchange_attention', entryId, date, ...extra },
    });
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
