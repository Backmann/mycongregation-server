import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { CleaningAssignment } from '../entities/cleaning-assignment.entity';
import { ReadinessService } from '../readiness/readiness.service';
import { AbsencesService } from '../absences/absences.service';
import { MeetingSettingsService } from '../meeting-settings/meeting-settings.service';
import { PublishersService } from '../publishers/publishers.service';
import {
  AbsencesSummary,
  CleaningSummary,
  NextDuties,
  PROGRAMME_WINDOW_WEEKS,
  ProgrammeSummary,
  absencesSummary,
  cleaningSummary,
  nextMeetingDuties,
  programmeSummary,
  windowEnd,
} from './summary-rules';

/** How far ahead the next own cleaning and the next visiting speaker are looked for. */
const LOOKAHEAD_WEEKS = 16;

export interface CongregationSummary {
  today: string;
  /** Only for those who may read the readiness count (it counts drafts). */
  programme?: ProgrammeSummary;
  duties: { next: NextDuties | null };
  talks: {
    nextIncoming: {
      date: string;
      speaker: string | null;
      congregation: string | null;
    } | null;
  };
  /** The elders' tasks — admins and elders, as the tasks screen. */
  tasks?: { open: number; overdue: number };
  absences: AbsencesSummary;
  cleaning: CleaningSummary;
  meetingPlace: {
    midweekDow: number;
    midweekTime: string;
    weekendDow: number;
    weekendTime: string;
  } | null;
  /** The roster's own count — for those who may browse it. */
  publishers?: { count: number };
  myGroup: { name: string; overseerName: string | null } | null;
  groups: { count: number };
}

/**
 * One answer for the «Собрание» contents (27 September): what stands under
 * each door, for this person.
 *
 * NOTHING HERE IS NEW TO ANYBODY. Every figure is one the person could already
 * read on the screen behind the door, by the rule that screen's own endpoint
 * applies: the readiness count only for those the readiness endpoint admits,
 * the absences as the absences list scopes them, the tasks for admins and
 * elders, the roster count for those who may browse the roster. Which doors
 * are drawn is the app's business; this only makes sure no line can say more
 * than its screen would.
 */
@Injectable()
export class CongregationSummaryService {
  constructor(
    private readonly clock: CongregationClock,
    private readonly readiness: ReadinessService,
    private readonly absences: AbsencesService,
    private readonly meetingSettings: MeetingSettingsService,
    private readonly publishersService: PublishersService,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(TalkExchange)
    private readonly talks: Repository<TalkExchange>,
    @InjectRepository(CleaningAssignment)
    private readonly cleaning: Repository<CleaningAssignment>,
  ) {}

  /** The readiness endpoint's own rule. */
  private async mayReadReadiness(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilities.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([
          ResponsibilityType.LIFE_MINISTRY_OVERSEER,
          ResponsibilityType.BODY_COORDINATOR,
          ResponsibilityType.DUTIES_COORDINATOR,
        ]),
      },
    });
    return held > 0;
  }

  async forUser(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<CongregationSummary> {
    const today = await this.clock.todayFor(tenantId);
    const thisMonday = mondayOf(today);
    const elderOrAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.ELDER;

    const [
      readinessAllowed,
      weeks,
      absenceRows,
      readAllAbsences,
      me,
      groups,
      settings,
      privileged,
    ] = await Promise.all([
      this.mayReadReadiness(user),
      this.readiness.forRange(
        tenantId,
        thisMonday,
        windowEnd(thisMonday, PROGRAMME_WINDOW_WEEKS),
      ),
      this.absences.findAll(tenantId, {}, user),
      this.absences.readsAll(user),
      this.publishers.findOne({
        where: { congregationId: tenantId, userId: user.id },
      }),
      this.groups.find({
        where: { congregationId: tenantId },
        order: { name: 'ASC' },
      }),
      this.meetingSettings.getEffective(tenantId, today),
      this.publishersService.resolvePrivateAccess(tenantId, user),
    ]);

    const groupName = (id: string) =>
      groups.find((g) => g.id === id)?.name ?? null;
    const myGroupId = me?.serviceGroupId ?? null;

    const [cleaningRows, nextTalk, taskRows, publisherCount, overseer] =
      await Promise.all([
        this.cleaning.find({
          where: {
            congregationId: tenantId,
            weekStartDate: MoreThanOrEqual(thisMonday),
          },
          order: { weekStartDate: 'ASC' },
          take: 200,
        }),
        this.talks.findOne({
          where: {
            congregationId: tenantId,
            direction: TalkExchangeDirection.INCOMING,
            date: MoreThanOrEqual(today),
            status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
          },
          relations: { visitingSpeaker: { externalCongregation: true } },
          order: { date: 'ASC' },
        }),
        elderOrAdmin
          ? this.tasks.find({
              where: { congregationId: tenantId, status: 'open' },
            })
          : Promise.resolve(null),
        privileged
          ? this.publishers.count({
              where: {
                congregationId: tenantId,
                appointment: Not(PublisherAppointment.STUDENT),
              },
            })
          : Promise.resolve(null),
        (() => {
          const id = myGroupId
            ? groups.find((g) => g.id === myGroupId)?.overseerPublisherId
            : null;
          return id
            ? this.publishers.findOne({
                where: { id, congregationId: tenantId },
              })
            : Promise.resolve(null);
        })(),
      ]);

    const lookaheadEnd = windowEnd(thisMonday, LOOKAHEAD_WEEKS);
    const speaker = nextTalk
      ? nextTalk.visitingSpeaker
        ? [
            nextTalk.visitingSpeaker.lastName,
            nextTalk.visitingSpeaker.firstName,
          ]
            .filter(Boolean)
            .join(' ')
        : nextTalk.speakerName?.trim() || null
      : null;
    const myGroup = myGroupId
      ? groups.find((g) => g.id === myGroupId)
      : undefined;

    return {
      today,
      ...(readinessAllowed
        ? { programme: programmeSummary(weeks, today) }
        : {}),
      duties: { next: nextMeetingDuties(weeks, today) },
      talks: {
        nextIncoming:
          nextTalk && nextTalk.date < lookaheadEnd
            ? {
                date: nextTalk.date,
                speaker,
                congregation:
                  nextTalk.visitingSpeaker?.externalCongregation?.name ??
                  (nextTalk.speakerCongregation?.trim() || null),
              }
            : null,
      },
      ...(taskRows
        ? {
            tasks: {
              open: taskRows.length,
              overdue: taskRows.filter((t) => !!t.dueDate && t.dueDate < today)
                .length,
            },
          }
        : {}),
      absences: absencesSummary(
        absenceRows.map((a) => ({
          publisherId: a.publisherId,
          startDate: a.startDate,
          endDate: a.endDate,
        })),
        today,
        readAllAbsences,
        me?.id ?? null,
      ),
      cleaning: cleaningSummary(
        cleaningRows.filter((r) => r.weekStartDate < lookaheadEnd),
        groupName,
        thisMonday,
        myGroupId,
        // The readiness weeks start on this Monday and know, by the week
        // rules, whether the congregation meets at all.
        (weeks.find((w) => w.weekStart === thisMonday)?.meetings.length ?? 0) >
          0,
      ),
      meetingPlace: settings
        ? {
            midweekDow: settings.midweekDow,
            midweekTime: settings.midweekTime,
            weekendDow: settings.weekendDow,
            weekendTime: settings.weekendTime,
          }
        : null,
      ...(publisherCount !== null
        ? { publishers: { count: publisherCount } }
        : {}),
      myGroup: myGroup
        ? { name: myGroup.name, overseerName: overseer?.displayName ?? null }
        : null,
      groups: { count: groups.length },
    };
  }
}
