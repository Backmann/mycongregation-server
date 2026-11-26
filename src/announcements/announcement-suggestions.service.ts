import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { MeetingAnnouncement } from '../entities/meeting-announcement.entity';
import { AnnouncementDismissal } from '../entities/announcement-dismissal.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { Congregation } from '../entities/congregation.entity';
import { WeekRulesService } from '../common/week-rules.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { todayIn } from '../common/congregation-clock';
import { addDaysISO, type MeetingKind } from '../common/week-rules';
import { mondayOf } from '../common/week';
import { coerceLanguage } from '../common/i18n/supported-languages';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { AnnouncementsService, assertMonday } from './announcements.service';
import { AnnouncementTemplatesService } from './announcement-templates.service';
import {
  suggestionsFrom,
  type Suggestion,
  type SuggestionGap,
  type SuggestionStage,
  type SuggestionTopic,
} from './suggestion-rules';

/** Weeks of week rules looked at: far enough for a convention 10 weeks ahead. */
const HORIZON_WEEKS = 18;
/** «Further on» lists what comes in the next weeks after the one shown. */
const UPCOMING_WEEKS = 6;
/** A finished accounts audit is told once, soon after; older ones are history. */
const AUDIT_BACK_DAYS = 45;

export interface SuggestionView {
  key: string;
  topic: SuggestionTopic;
  stage: SuggestionStage;
  text: string;
  gaps: SuggestionGap[];
  /** The meetings of the week it may still go to (none in the past). */
  meetings: { kind: MeetingKind; date: string }[];
  defaultKinds: MeetingKind[];
  eventId: string | null;
}

export interface WeekSuggestions {
  weekStartDate: string;
  today: string;
  items: SuggestionView[];
  /** What comes in the following weeks: only the topic and the week. */
  upcoming: {
    key: string;
    topic: SuggestionTopic;
    stage: SuggestionStage;
    weekStartDate: string;
  }[];
  /**
   * Announcements taken from a suggestion that no longer matches: its facts
   * changed («changed» — the words can be refreshed), it now belongs to
   * another week («moved» — the event moved), or it is no longer there
   * («gone» — the event was deleted).
   */
  stale: { announcementId: string; reason: StaleReason }[];
}

export type StaleReason = 'changed' | 'moved' | 'gone';

/** Whether a taken announcement still matches what it was taken from. */
export function staleReason(
  row: { weekStartDate: string; sourceFacts: string | null },
  now: Suggestion | undefined,
): StaleReason | null {
  if (!now) return 'gone';
  if (now.targetWeek !== row.weekStartDate) return 'moved';
  if (now.facts !== row.sourceFacts) return 'changed';
  return null;
}

/** «co_visit:ahead:<id>.midweek» → «co_visit:ahead:<id>». */
export function baseKey(sourceKey: string): string {
  return sourceKey.replace(/\.(midweek|weekend)$/, '');
}

/**
 * Suggested announcements for the writers (announcements R-09).
 *
 * Read for a week: what the app offers for its meetings, what comes next,
 * and which taken ones have gone stale. Taking one writes ordinary
 * announcements (one per meeting chosen) through AnnouncementsService, so
 * the order, the journal and the unique «taken once» index are the same as
 * for one written by hand.
 */
@Injectable()
export class AnnouncementSuggestionsService {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    @InjectRepository(MeetingAnnouncement)
    private readonly repo: Repository<MeetingAnnouncement>,
    @InjectRepository(AnnouncementDismissal)
    private readonly dismissals: Repository<AnnouncementDismissal>,
    @InjectRepository(SpecialEvent)
    private readonly events: Repository<SpecialEvent>,
    @InjectRepository(FieldServiceMeeting)
    private readonly fieldService: Repository<FieldServiceMeeting>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly templates: AnnouncementTemplatesService,
  ) {}

  /**
   * Every suggestion there is now. `all` — what may still be offered (this
   * week on, meetings to come); `raw` — every one computed, this week's
   * meetings already held included, to judge the announcements taken from
   * them (a taken one must not turn «gone» once its meeting is held).
   */
  async compute(
    congregationId: string,
  ): Promise<{ today: string; all: Suggestion[]; raw: Suggestion[] }> {
    const today = await this.clock.todayFor(congregationId);
    const start = mondayOf(today);
    const end = addDaysISO(start, 7 * HORIZON_WEEKS - 1);
    // One week back as well: an audit ticked done last Saturday is told at
    // this week's midweek meeting (found by the independent check).
    const first = addDaysISO(start, -7);
    const mondays = Array.from({ length: HORIZON_WEEKS + 1 }, (_, i) =>
      addDaysISO(first, 7 * i),
    );
    const [rules, cong, events, fs, audits, tz, templates] = await Promise.all([
      this.weekRules.forWeeks(congregationId, mondays),
      this.congregations.findOne({
        where: { id: congregationId },
        select: { id: true, language: true },
      }),
      this.events.find({
        where: {
          congregationId,
          deletedAt: IsNull(),
          date: Between(start, end),
        },
      }),
      this.fieldService.find({
        where: { congregationId, weekStartDate: Between(start, end) },
      }),
      this.tasks.find({
        where: {
          congregationId,
          kind: 'accounts_audit',
          status: 'done',
          doneAt: MoreThan(
            new Date(Date.now() - AUDIT_BACK_DAYS * 24 * 3600 * 1000),
          ),
        },
      }),
      this.clock.timezoneOf(congregationId),
      this.templates.load(congregationId),
    ]);
    const raw = suggestionsFrom({
      lang: coerceLanguage(cong?.language),
      templates,
      weeks: rules,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        date: e.date,
        endDate: e.endDate,
        time: e.time,
        coMidweekDow: e.coMidweekDow,
      })),
      fieldService: fs.map((m) => ({
        date: addDaysISO(m.weekStartDate, m.dayOfWeek - 1),
        time: m.startTime,
        published: !!m.publishedAt,
        cancelled: !!m.cancelledAt,
        movedFromDate: m.movedFromDate,
        notice: m.notice,
      })),
      audits: audits
        .filter((t) => t.kindPeriod && t.doneAt)
        .map((t) => ({
          period: t.kindPeriod!,
          doneOn: todayIn(t.doneAt!, tz),
        })),
    });
    // Nothing for a meeting already held: a past window is not «missed» (R-06).
    const ahead = raw
      .map((s) => ({
        ...s,
        meetings: s.meetings.filter((m) => m.date >= today),
      }))
      .filter(
        (s) => s.enabled && s.targetWeek >= start && s.meetings.length > 0,
      )
      .map((s) => {
        const left = new Set(s.meetings.map((m) => m.kind));
        const defaults = s.defaultKinds.filter((k) => left.has(k));
        return {
          ...s,
          defaultKinds: defaults.length ? defaults : [s.meetings[0].kind],
        };
      });
    return { today, all: ahead, raw };
  }

  /** The keys already taken or let go, for one congregation. */
  private async settled(congregationId: string): Promise<Set<string>> {
    const [taken, gone] = await Promise.all([
      this.repo.find({
        where: { congregationId, sourceKey: Not(IsNull()) },
        select: { id: true, sourceKey: true },
      }),
      this.dismissals.find({
        where: { congregationId },
        select: { id: true, sourceKey: true },
      }),
    ]);
    return new Set([
      ...taken.map((a) => baseKey(a.sourceKey!)),
      ...gone.map((d) => d.sourceKey),
    ]);
  }

  async forWeek(
    user: AuthenticatedUser,
    week: string,
  ): Promise<WeekSuggestions> {
    await this.announcements.assertWriter(user);
    const w = assertMonday(week);
    const congregationId = user.congregationId;
    const [{ today, all, raw }, settled, rows] = await Promise.all([
      this.compute(congregationId),
      this.settled(congregationId),
      this.repo.find({
        where: {
          congregationId,
          weekStartDate: w,
          sourceFacts: Not(IsNull()),
        },
        select: {
          id: true,
          sourceKey: true,
          sourceFacts: true,
          weekStartDate: true,
        },
      }),
    ]);
    const open = all.filter((s) => !settled.has(s.key));
    const lastUpcoming = addDaysISO(w, 7 * UPCOMING_WEEKS);
    const byKey = new Map(raw.map((s) => [s.key, s]));
    // A past week is history: its suggestions are no longer computed.
    const judged = w >= mondayOf(today);
    return {
      weekStartDate: w,
      today,
      items: open.filter((s) => s.targetWeek === w).map(viewOf),
      upcoming: open
        .filter((s) => s.targetWeek > w && s.targetWeek <= lastUpcoming)
        .sort((a, b) => a.targetWeek.localeCompare(b.targetWeek))
        .map((s) => ({
          key: s.key,
          topic: s.topic,
          stage: s.stage,
          weekStartDate: s.targetWeek,
        })),
      stale: judged
        ? rows.flatMap((a): WeekSuggestions['stale'] => {
            const reason = staleReason(
              a,
              a.sourceKey ? byKey.get(baseKey(a.sourceKey)) : undefined,
            );
            return reason ? [{ announcementId: a.id, reason }] : [];
          })
        : [],
    };
  }

  /** For the line on Home: how much waits for a writer this week and next. */
  async summary(user: AuthenticatedUser): Promise<{
    weekStartDate: string;
    suggestions: number;
    stale: number;
  }> {
    await this.announcements.assertWriter(user);
    const congregationId = user.congregationId;
    const { today, all, raw } = await this.compute(congregationId);
    const settled = await this.settled(congregationId);
    const w = mondayOf(today);
    const next = addDaysISO(w, 7);
    const suggestions = all.filter(
      (s) =>
        !settled.has(s.key) && (s.targetWeek === w || s.targetWeek === next),
    ).length;
    const rows = await this.repo.find({
      where: {
        congregationId,
        weekStartDate: In([w, next]),
        sourceFacts: Not(IsNull()),
      },
      select: {
        id: true,
        sourceKey: true,
        sourceFacts: true,
        weekStartDate: true,
      },
    });
    const byKey = new Map(raw.map((s) => [s.key, s]));
    const stale = rows.filter(
      (a) =>
        staleReason(
          a,
          a.sourceKey ? byKey.get(baseKey(a.sourceKey)) : undefined,
        ) !== null,
    ).length;
    return { weekStartDate: w, suggestions, stale };
  }

  /** «Add»: the suggestion becomes one announcement per meeting chosen. */
  async take(
    user: AuthenticatedUser,
    dto: { weekStartDate: string; key: string; kinds: string[]; text: string },
  ) {
    await this.announcements.assertWriter(user);
    const w = assertMonday(dto.weekStartDate);
    const { all } = await this.compute(user.congregationId);
    const s = all.find((x) => x.key === dto.key && x.targetWeek === w);
    if (!s) throw gone();
    const settled = await this.settled(user.congregationId);
    if (settled.has(s.key)) {
      throw new ConflictException(
        refusal(
          'ANNOUNCEMENT_ALREADY_ADDED',
          'This suggestion has already been added.',
        ),
      );
    }
    const allowed = new Set<string>(s.meetings.map((m) => m.kind));
    const kinds = [...new Set(dto.kinds)];
    if (!kinds.length || kinds.some((k) => !allowed.has(k))) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Not a meeting this suggestion may go to.', {
          field: 'kinds',
        }),
      );
    }
    const out: Awaited<ReturnType<AnnouncementsService['create']>>[] = [];
    for (const kind of s.meetings
      .map((m) => m.kind)
      .filter((k) => kinds.includes(k))) {
      out.push(
        await this.announcements.create(user, {
          weekStartDate: w,
          eventType: kind,
          text: dto.text,
          source: s.topic,
          sourceKey: `${s.key}.${kind}`,
          sourceFacts: s.facts,
        }),
      );
    }
    return out;
  }

  /** «Not needed». */
  async dismiss(user: AuthenticatedUser, key: string): Promise<void> {
    await this.announcements.assertWriter(user);
    const { all } = await this.compute(user.congregationId);
    const s = all.find((x) => x.key === key);
    if (!s) throw gone();
    await this.dismissals
      .createQueryBuilder()
      .insert()
      .values({
        congregationId: user.congregationId,
        sourceKey: s.key,
        // Kept until the thing itself has passed, even if it moves later.
        weekStartDate:
          s.anchorWeek > s.targetWeek ? s.anchorWeek : s.targetWeek,
      })
      .orIgnore()
      .execute();
  }

  /** «Update the text»: a stale one takes today's words and facts. */
  async refresh(user: AuthenticatedUser, announcementId: string) {
    await this.announcements.assertWriter(user);
    const a = await this.announcements.own(user, announcementId);
    if (!a.sourceKey || !a.sourceFacts) throw gone();
    const { raw } = await this.compute(user.congregationId);
    const s = raw.find((x) => x.key === baseKey(a.sourceKey!));
    if (!s) throw gone();
    // Moved to another week: new words here would say «next week» in the
    // wrong week. The writer deletes it and takes it again where it now is.
    if (s.targetWeek !== a.weekStartDate) {
      throw new ConflictException(
        refusal(
          'ANNOUNCEMENT_SUGGESTION_MOVED',
          'The event now belongs to another week.',
        ),
      );
    }
    return this.announcements.update(user, a.id, {
      text: s.text,
      sourceFacts: s.facts,
    });
  }
}

function viewOf(s: Suggestion): SuggestionView {
  return {
    key: s.key,
    topic: s.topic,
    stage: s.stage,
    text: s.text,
    gaps: s.gaps,
    meetings: s.meetings,
    defaultKinds: s.defaultKinds,
    eventId: s.eventId,
  };
}

function gone(): NotFoundException {
  return new NotFoundException(
    refusal(
      'ANNOUNCEMENT_SUGGESTION_GONE',
      'This suggestion is no longer offered.',
    ),
  );
}
