import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import {
  TerritoryAssignment,
  TerritoryMethod,
} from '../entities/territory-assignment.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { TerritoryBusinessVisit } from '../entities/territory-business-visit.entity';
import { TerritorySplit } from '../entities/territory-split.entity';
import { TerritoryStreetMark } from '../entities/territory-street-mark.entity';
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Congregation } from '../entities/congregation.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assignedWords,
  handedOnWords,
  meetingDroppedWords,
} from './territory-words';
import { ANONYMOUS_HOLDER, namesKeptFrom } from './territory-retention';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { assertAssignable } from '../common/inactive';
import { minutesOfDayIn, todayIn } from '../common/congregation-clock';
import { meetingHasBegun } from './meeting-time';
import {
  TerritoryAccess,
  TerritoryAccessService,
  TerritoryPerson,
} from './territory-access.service';
import {
  addDays,
  addMonths,
  keptFrom,
  serviceYearOf,
  serviceYearStart,
  TERM_DAYS,
} from './service-year';
import type {
  AssignTerritoryDto,
  CompleteAssignmentDto,
  EditAssignmentDto,
  ExtendAssignmentDto,
  PastAssignmentDto,
  ReturnAssignmentDto,
} from './dto/assignment.dto';
import { awaitingRecut, mustNotBeHeldBack } from './recut-apply';

const PG_UNIQUE_VIOLATION = '23505';
/** The exclusion constraint: two lines of a territory lie over each other. */
const PG_EXCLUSION_VIOLATION = '23P01';
const FAR = '9999-12-31';

/** Who held a line, as the S-13 writes it. */
interface Holder {
  publisherId: string | null;
  holderName: string;
  forGroupId: string | null;
  forGroupName: string | null;
  /** His login, to tell him; null — no app or no card. */
  userId: string | null;
}

/** How a holder is written on the S-13: surname first. */
export function holderNameOf(p: {
  lastName: string;
  firstName: string;
}): string {
  return `${p.lastName} ${p.firstName}`.trim();
}

/**
 * The life of an assignment (11 November 2026): given out for four months,
 * worked or handed back, extended once by the holder himself.
 *
 *  - keepers (the territory servant, his assistant, administrators) give out,
 *    take back, extend and correct;
 *  - the holder marks his own territory worked or handed back and may ask
 *    once for a month more;
 *  - a group overseer and the members of a group see the territories held
 *    for their group, with the «не беспокоить» addresses — they are the ones
 *    walking it.
 *
 * Nothing here works before the brought-over records are confirmed.
 */
@Injectable()
export class TerritoryAssignmentsService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(TerritoryNoCall)
    private readonly noCalls: Repository<TerritoryNoCall>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ServiceGroup)
    private readonly groups: Repository<ServiceGroup>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(FieldServiceMeeting)
    private readonly meetings: Repository<FieldServiceMeeting>,
    @InjectRepository(TerritoryBusinessVisit)
    private readonly businessVisits: Repository<TerritoryBusinessVisit>,
    @InjectRepository(TerritorySplit)
    private readonly splits: Repository<TerritorySplit>,
    @InjectRepository(TerritoryStreetMark)
    private readonly streetMarks: Repository<TerritoryStreetMark>,
  ) {}

  /**
   * A business territory's «visited» marks belong to one assignment and go
   * when the territory comes back (13 November 2026, decision: marks are
   * wiped on return; the record keeps only «worked»). So do a residential
   * territory's divisions between groups and «street walked» marks.
   */
  /**
   * His «Попросить участок» is answered (17 November 2026): a territory of
   * his own reached him — given, handed on to him, entered as held, or the
   * holder corrected to him. A territory for his group is not his own: his
   * own request stays open (independent review, 17 November 2026).
   */
  private async answerRequest(
    tenantId: string,
    line: Pick<TerritoryAssignment, 'publisherId' | 'forGroupId'>,
    userId: string,
  ): Promise<void> {
    if (!line.publisherId || line.forGroupId) return;
    await this.assignments.manager.query(
      `UPDATE territory_requests
          SET closed_at = now(), closed_how = 'given', closed_by_user_id = $3
        WHERE congregation_id = $1 AND publisher_id = $2 AND closed_at IS NULL`,
      [tenantId, line.publisherId, userId],
    );
  }

  private async forgetMarks(assignmentId: string): Promise<void> {
    await this.businessVisits.delete({ assignmentId });
    await this.streetMarks.delete({ assignmentId });
    await this.splits.delete({ assignmentId });
  }

  private async today(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  private notOpen(): ConflictException {
    return new ConflictException(
      refusal(
        'TERRITORY_NOT_OPEN',
        'The territory records are not confirmed yet.',
      ),
    );
  }

  private dates(why: string): BadRequestException {
    return new BadRequestException(refusal('TERRITORY_DATES', why));
  }

  private overlaps(): BadRequestException {
    return new BadRequestException(
      refusal('TERRITORY_OVERLAP', 'Lies over another line of this territory.'),
    );
  }

  /** A save refused by the database, said the way the screens say it. */
  private refused(e: unknown): never {
    const code = (e as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION) {
      throw new ConflictException(
        refusal('TERRITORY_HELD', 'The territory is already given out.'),
      );
    }
    if (code === PG_EXCLUSION_VIOLATION) throw this.overlaps();
    throw e;
  }

  /**
   * Whether [start, end) lies over another line of the territory. A line may
   * start the day the one before it ended; an open line runs on without end.
   * The database checks the same (territory_assignments_no_overlap) — this
   * answers first, with the words the screen shows.
   */
  private async liesOver(
    congregationId: string,
    territoryId: string,
    start: string,
    end: string | null,
    except?: string,
  ): Promise<boolean> {
    const others = await this.assignments.find({
      where: { territoryId, congregationId },
      select: {
        id: true,
        assignedOn: true,
        completedOn: true,
        returnedOn: true,
      },
    });
    const to = end ?? FAR;
    return others.some((o) => {
      if (o.id === except) return false;
      const oEnd = o.completedOn ?? o.returnedOn ?? FAR;
      return o.assignedOn < to && oEnd > start;
    });
  }

  /**
   * Who a line is written for (17 November 2026). A card of this
   * congregation, or «нет в списке» — a name by hand, tied to no card. A
   * line still in someone's hands needs a card one may give a task to now;
   * an ended one only a card that is still there.
   */
  private async holderOf(
    tenantId: string,
    want: {
      publisherId?: string | null;
      holderName?: string;
      forGroupId?: string | null;
    },
    open: boolean,
    /**
     * The line as it stands: its own group is kept as written even when the
     * group has since been deleted (review of 17 November 2026).
     */
    line?: Pick<TerritoryAssignment, 'forGroupId' | 'forGroupName'>,
  ): Promise<Holder> {
    let group: { id: string; name: string } | null = null;
    if (want.forGroupId && line && want.forGroupId === line.forGroupId) {
      group = { id: line.forGroupId, name: line.forGroupName ?? '' };
    } else if (want.forGroupId) {
      group = await this.groups.findOne({
        where: { id: want.forGroupId, congregationId: tenantId },
      });
      if (!group) throw new NotFoundException('Group not found');
    }
    const name = want.holderName?.trim();
    if (name !== undefined && !want.publisherId) {
      if (name.length < 2) {
        throw new BadRequestException(
          refusal('PERSON_NOT_ASSIGNABLE', 'Write the name.'),
        );
      }
      return {
        publisherId: null,
        holderName: name,
        forGroupId: group?.id ?? null,
        forGroupName: group?.name ?? null,
        userId: null,
      };
    }
    const p = want.publisherId
      ? await this.publishers.findOne({
          where: { id: want.publisherId, congregationId: tenantId },
        })
      : null;
    if (!p || p.removedAt || (open && !p.isActive)) {
      throw new BadRequestException(
        refusal(
          'PERSON_NOT_ASSIGNABLE',
          'This person cannot be given a task at the moment.',
        ),
      );
    }
    if (open)
      await assertAssignable(this.assignments.manager, tenantId, [p.id]);
    return {
      publisherId: p.id,
      holderName: holderNameOf(p),
      forGroupId: group?.id ?? null,
      forGroupName: group?.name ?? null,
      userId: p.userId ?? null,
    };
  }

  private async mustKeepOpen(
    user: AuthenticatedUser,
  ): Promise<TerritoryAccess> {
    const a = await this.access.mustKeep(user);
    if (!a.verified) throw this.notOpen();
    return a;
  }

  // ---------------------------------------------------------- what I see --

  /**
   * The territories the user has a part in, outside the whole section: his
   * own, and those held for a group he oversees or belongs to. Each comes
   * with its shape and its «не беспокоить» addresses, nothing else of its
   * history.
   */
  async mine(user: AuthenticatedUser) {
    const verified =
      (await this.access.verifiedAt(user.congregationId)) !== null;
    if (!verified) return [];
    const me = await this.access.person(user);
    return this.visibleTo(user.congregationId, me);
  }

  /**
   * The meetings for field service that go out to a territory the day
   * before and on the day (11 November 2026): a group's meeting for its
   * members and its conductor, any other for everyone — the way the group's
   * own territory is seen. Only published meetings that are not called off.
   */
  async meetingsSeenBy(
    congregationId: string,
    me: TerritoryPerson,
    today: string,
  ) {
    if (!me.publisherId) return [];
    const tomorrow = addDays(today, 1);
    const weeks = [...new Set([mondayOf(today), mondayOf(tomorrow)])];
    const rows = await this.meetings.find({
      where: {
        congregationId,
        weekStartDate: In(weeks),
        territoryId: Not(IsNull()),
        cancelledAt: IsNull(),
        publishedAt: Not(IsNull()),
      },
    });
    const near = rows
      .map((m) => ({ m, date: addDays(m.weekStartDate, m.dayOfWeek - 1) }))
      .filter(({ date }) => date === today || date === tomorrow)
      .filter(
        ({ m }) =>
          !m.serviceGroupId ||
          m.serviceGroupId === me.memberOf ||
          me.oversees.includes(m.serviceGroupId) ||
          m.conductorPublisherId === me.publisherId,
      );
    // Only while the territory is still its conductor's or his group's
    // (12 November 2026): a territory taken back, or a meeting handed to
    // another conductor, must not send anyone to someone else's ground.
    const still: typeof near = [];
    for (const x of near) {
      if (await this.meetingStillHolds(x.m)) still.push(x);
    }
    return still.map(({ m, date }) => ({
      id: m.id,
      territoryId: m.territoryId!,
      date,
      startTime: m.startTime,
      address: m.address,
    }));
  }

  private async visibleTo(congregationId: string, me: TerritoryPerson) {
    if (!me.publisherId) return [];
    const groupIds = [
      ...new Set([...me.oversees, ...(me.memberOf ? [me.memberOf] : [])]),
    ];
    const open = { completedOn: IsNull(), returnedOn: IsNull() };
    const today = await this.today(congregationId);
    const viaMeeting = await this.meetingsSeenBy(congregationId, me, today);
    const meetingOf = new Map(viaMeeting.map((m) => [m.territoryId, m]));
    const rows = await this.assignments.find({
      where: [
        { congregationId, publisherId: me.publisherId, ...open },
        ...(groupIds.length
          ? [{ congregationId, forGroupId: In(groupIds), ...open }]
          : []),
        ...(meetingOf.size
          ? [
              {
                congregationId,
                territoryId: In([...meetingOf.keys()]),
                ...open,
              },
            ]
          : []),
      ],
      order: { dueOn: 'ASC' },
    });
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((a) => a.territoryId))];
    const terr = await this.territories.find({
      where: { id: In(ids), congregationId, archivedAt: IsNull() },
    });
    const byId = new Map(terr.map((t) => [t.id, t]));
    const calls = await this.noCalls.find({
      where: { territoryId: In(ids), congregationId },
      order: { notedOn: 'DESC' },
    });
    const waits = await awaitingRecut(
      this.assignments.manager,
      congregationId,
      ids,
    );
    return rows
      .filter((a) => byId.has(a.territoryId))
      .map((a) => {
        const t = byId.get(a.territoryId)!;
        const m = meetingOf.get(t.id);
        return {
          id: t.id,
          number: t.number,
          locality: t.locality,
          // A business territory comes with its list (13 November 2026).
          category: t.category,
          geometry: t.geometry,
          assignment: {
            id: a.id,
            holderName: a.holderName,
            forGroupId: a.forGroupId,
            forGroupName: a.forGroupName,
            assignedOn: a.assignedOn,
            dueOn: a.dueOn,
            extended: a.extended,
            mine: a.publisherId === me.publisherId,
            // Waits for a decided re-cutting: not «kept for working again».
            awaitsRecut: waits.has(t.id),
          },
          meeting: m
            ? {
                id: m.id,
                date: m.date,
                startTime: m.startTime,
                address: m.address,
              }
            : null,
          noCalls: calls
            .filter((n) => n.territoryId === t.id)
            .map((n) => ({
              id: n.id,
              address: n.address,
              surname: n.surname,
              notedOn: n.notedOn,
            })),
        };
      });
  }

  // ---------------------------------------------------------- giving out --

  /**
   * Who the territory may go to, with what each already holds and when he
   * last had this one (within the kept years). Inactive, removed and
   * departed cards are not offered.
   */
  async candidates(user: AuthenticatedUser, territoryId: string) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: { id: territoryId, congregationId: tenantId },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const alive = {
      congregationId: tenantId,
      isActive: true,
      removedAt: IsNull(),
    };
    // A status not computed yet (NULL) is not «inactive».
    const all = await this.publishers.find({
      where: [
        { ...alive, status: Not(PublisherStatus.INACTIVE) },
        { ...alive, status: IsNull() },
      ],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        pioneerType: true,
        serviceGroupId: true,
        userId: true,
      },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    const today = await this.today(tenantId);
    const open = await this.assignments.find({
      where: {
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
        publisherId: Not(IsNull()),
      },
    });
    const heldIds = [...new Set(open.map((a) => a.territoryId))];
    const numberOf = new Map(
      (heldIds.length
        ? await this.territories.find({
            where: { id: In(heldIds), congregationId: tenantId },
            select: { id: true, number: true },
          })
        : []
      ).map((x) => [x.id, x.number]),
    );
    const past = await this.assignments.find({
      where: {
        congregationId: tenantId,
        territoryId,
        assignedOn: MoreThanOrEqual(keptFrom(today)),
      },
      select: { id: true, publisherId: true, assignedOn: true },
    });
    const groups = await this.groups.find({
      where: { congregationId: tenantId },
      select: { id: true, name: true, overseerPublisherId: true },
      order: { name: 'ASC' },
    });
    return {
      territory: { id: t.id, number: t.number, locality: t.locality },
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        overseerPublisherId: g.overseerPublisherId,
      })),
      people: all.map((p) => {
        const mine = open.filter((a) => a.publisherId === p.id);
        const last = past
          .filter((a) => a.publisherId === p.id)
          .map((a) => a.assignedOn)
          .sort()
          .pop();
        return {
          publisherId: p.id,
          name: p.displayName,
          pioneer: p.pioneerType !== 'none',
          serviceGroupId: p.serviceGroupId,
          holds: mine.map((a) => numberOf.get(a.territoryId) ?? '?'),
          overdue: mine.filter((a) => a.dueOn !== null && a.dueOn < today)
            .length,
          hadThisOn: last ?? null,
          // Whether he sees it in the app, or needs a link or paper.
          hasApp: !!p.userId,
        };
      }),
    };
  }

  /**
   * «Выдача и приём» (13 November 2026; mockup): everything the territory
   * servant's desk needs in one answer — the people one may give to (with
   * whether they have the app), what is out now (also with holders brought
   * over without a card), and who had which territory in the years kept,
   * for «он уже был там» and the year's counts. The free territories come
   * from the list itself.
   */
  async desk(user: AuthenticatedUser) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const alive = {
      congregationId: tenantId,
      isActive: true,
      removedAt: IsNull(),
    };
    const people = await this.publishers.find({
      where: [
        { ...alive, status: Not(PublisherStatus.INACTIVE) },
        { ...alive, status: IsNull() },
      ],
      select: {
        id: true,
        displayName: true,
        pioneerType: true,
        serviceGroupId: true,
        userId: true,
      },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
    const groups = await this.groups.find({
      where: { congregationId: tenantId },
      select: { id: true, name: true, overseerPublisherId: true },
      order: { name: 'ASC' },
    });
    const open = await this.assignments.find({
      where: {
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
      order: { dueOn: 'ASC' },
    });
    const kept = await this.assignments.find({
      where: {
        congregationId: tenantId,
        assignedOn: MoreThanOrEqual(keptFrom(today)),
        publisherId: Not(IsNull()),
      },
      select: {
        id: true,
        publisherId: true,
        territoryId: true,
        assignedOn: true,
        completedOn: true,
        returnedOn: true,
      },
    });
    const terr = await this.territories.find({
      where: {
        congregationId: tenantId,
        id: In([...new Set(open.map((a) => a.territoryId))]),
      },
      select: { id: true, number: true, locality: true, category: true },
    });
    const byId = new Map(terr.map((t) => [t.id, t]));
    // A month before the S-13 lets go of a service year's names (1
    // September), the territory servant sees how many lines will read «—»
    // (17 November 2026): time to print or copy what he still needs.
    const nextYear = serviceYearStart(serviceYearOf(today) + 1);
    let namesGo: { on: string; count: number } | null = null;
    if (addDays(nextYear, -31) <= today) {
      const [row] = await this.assignments.manager.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM territory_assignments
          WHERE congregation_id = $1
            AND COALESCE(completed_on, returned_on) < $2
            AND holder_name <> $3`,
        [tenantId, namesKeptFrom(nextYear), ANONYMOUS_HOLDER],
      );
      if (row.n > 0) namesGo = { on: nextYear, count: row.n };
    }
    return {
      today,
      namesGo,
      people: people.map((p) => ({
        publisherId: p.id,
        name: p.displayName,
        pioneer: p.pioneerType !== 'none',
        serviceGroupId: p.serviceGroupId,
        hasApp: !!p.userId,
      })),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        overseerPublisherId: g.overseerPublisherId,
      })),
      out: open
        .filter((a) => byId.has(a.territoryId))
        .map((a) => {
          const t = byId.get(a.territoryId)!;
          return {
            assignmentId: a.id,
            territoryId: t.id,
            number: t.number,
            locality: t.locality,
            category: t.category,
            publisherId: a.publisherId,
            holderName: a.holderName,
            forGroupId: a.forGroupId,
            forGroupName: a.forGroupName,
            assignedOn: a.assignedOn,
            dueOn: a.dueOn,
            extended: a.extended,
            paperWanted: !!a.paperWantedAt,
          };
        }),
      history: kept.map((a) => ({
        publisherId: a.publisherId!,
        territoryId: a.territoryId,
        assignedOn: a.assignedOn,
        completedOn: a.completedOn,
        returnedOn: a.returnedOn,
      })),
    };
  }

  /**
   * A paper map wanted, or printed (13 November 2026): the queue the
   * territory servant prints from on a computer.
   */
  async paper(user: AuthenticatedUser, id: string, wanted: boolean) {
    await this.mustKeepOpen(user);
    const a = await this.assignments.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    if (wanted && (a.completedOn || a.returnedOn)) {
      throw new ConflictException(
        refusal('TERRITORY_ENDED', 'The territory has already come back.'),
      );
    }
    a.paperWantedAt = wanted ? new Date() : null;
    await this.assignments.save(a);
    return { id: a.id, paperWanted: wanted };
  }

  async assign(
    user: AuthenticatedUser,
    territoryId: string,
    dto: AssignTerritoryDto,
  ) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: {
        id: territoryId,
        congregationId: tenantId,
        archivedAt: IsNull(),
      },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const p = await this.publishers.findOne({
      where: { id: dto.publisherId, congregationId: tenantId },
    });
    if (!p || p.removedAt || !p.isActive) {
      throw new BadRequestException(
        refusal(
          'PERSON_NOT_ASSIGNABLE',
          'This person cannot be given a task at the moment.',
        ),
      );
    }
    await assertAssignable(this.assignments.manager, tenantId, [p.id]);
    let group: ServiceGroup | null = null;
    if (dto.forGroupId) {
      group = await this.groups.findOne({
        where: { id: dto.forGroupId, congregationId: tenantId },
      });
      if (!group) throw new NotFoundException('Group not found');
    }
    const today = await this.today(tenantId);
    const assignedOn = dto.assignedOn ?? today;
    if (assignedOn > today) throw this.dates('given out in the future');
    if (serviceYearOf(assignedOn) < serviceYearOf(today)) {
      throw new BadRequestException(
        refusal('TERRITORY_PAST_YEAR', 'Only the current service year.'),
      );
    }
    // Not over any line already there — not only the newest one: a
    // territory handed on twice in a day has two lines of that day (review
    // of 17 November 2026).
    const held = await this.assignments.findOne({
      where: {
        territoryId: t.id,
        congregationId: tenantId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
      select: { id: true },
    });
    if (held) {
      throw new ConflictException(
        refusal('TERRITORY_HELD', 'The territory is already given out.'),
      );
    }
    if (await this.liesOver(tenantId, t.id, assignedOn, null)) {
      throw this.dates('given out before it came back');
    }
    const dueOn = dto.dueOn ?? addDays(assignedOn, TERM_DAYS);
    if (dueOn <= assignedOn) throw this.dates('due before given out');
    let saved: TerritoryAssignment;
    try {
      saved = await this.assignments.manager.transaction(async (m) => {
        // Read again, shared-locked, in the same transaction as the insert:
        // a join applied meanwhile (territory-recut-apply) holds the row and
        // archives it — then it is not given out (16 November 2026).
        const [still] = await m.query<{ id: string }[]>(
          `SELECT id FROM territories
            WHERE id = $1 AND congregation_id = $2 AND archived_at IS NULL
            FOR SHARE`,
          [t.id, tenantId],
        );
        if (!still) throw new NotFoundException('Territory not found');
        // Held back for a join of the re-cutting draft: let go only together
        // with giving it out.
        await mustNotBeHeldBack(
          m,
          tenantId,
          t.id,
          t.number,
          dto.releaseHold === true,
        );
        return m.save(
          m.create(TerritoryAssignment, {
            congregationId: tenantId,
            territoryId: t.id,
            publisherId: p.id,
            holderName: holderNameOf(p),
            forGroupId: group?.id ?? null,
            forGroupName: group?.name ?? null,
            assignedOn,
            dueOn,
            completedOn: null,
            returnedOn: null,
            method: null,
            extended: false,
            imported: false,
            createdByUserId: user.id,
          }),
        );
      });
    } catch (e) {
      this.refused(e);
    }
    await this.log(user, saved, 'CREATE', {
      number: t.number,
      assignedOn,
      dueOn,
      forGroup: group?.name ?? null,
    });
    await this.answerRequest(tenantId, saved, user.id);
    // «Вам выдан участок …» — to the holder, if he has the app.
    if (p.userId) {
      await this.notifications.notify({
        tenantId,
        userIds: [p.userId],
        kind: 'territory_assigned',
        key: `territory-assigned:${saved.id}`,
        text: (lang) => assignedWords(t.number, dueOn, lang),
        data: { type: 'territory', territoryId: t.id },
      });
    }
    return saved;
  }

  // ------------------------------------------------- ending and extending --

  /**
   * The open assignment and whether the user may act on it: a keeper always,
   * the holder for his own.
   */
  private async openFor(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ a: TerritoryAssignment; keeps: boolean }> {
    const verified =
      (await this.access.verifiedAt(user.congregationId)) !== null;
    if (!verified) throw this.notOpen();
    const a = await this.assignments.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    const access = await this.access.of(user);
    let mayAct = access.keeps;
    if (!mayAct) {
      const me = await this.access.person(user);
      mayAct = !!me.publisherId && a.publisherId === me.publisherId;
    }
    if (!mayAct) {
      // A holder who is not the one asking learns nothing about it.
      throw new NotFoundException('Assignment not found');
    }
    if (a.completedOn || a.returnedOn) {
      throw new ConflictException(
        refusal('TERRITORY_ENDED', 'The territory has already come back.'),
      );
    }
    return { a, keeps: access.keeps };
  }

  async complete(
    user: AuthenticatedUser,
    id: string,
    dto: CompleteAssignmentDto,
  ) {
    const { a } = await this.openFor(user, id);
    const today = await this.today(user.congregationId);
    const on = dto.completedOn ?? today;
    if (on > today) throw this.dates('worked in the future');
    if (on < a.assignedOn) throw this.dates('worked before given out');
    a.completedOn = on;
    a.method = (dto.method as TerritoryMethod) ?? 'door_to_door';
    // Kept for working again: the same holder, a new line from the same day,
    // a new term — in one transaction with the end of the old one.
    let again: TerritoryAssignment | null = null;
    // Not a territory a decided re-cutting waits for (17 November 2026):
    // kept again, it would put the committee's decision off by four months
    // without anyone seeing why. It goes back to the territory servant.
    if (
      dto.again &&
      (
        await awaitingRecut(this.assignments.manager, a.congregationId, [
          a.territoryId,
        ])
      ).size > 0
    ) {
      const t = await this.territories.findOne({
        where: { id: a.territoryId, congregationId: a.congregationId },
        select: { id: true, number: true },
      });
      throw new ConflictException(
        refusal(
          'TERRITORY_AWAITS_RECUT',
          'The territory waits for a decided re-cutting.',
          { number: t?.number ?? '' },
        ),
      );
    }
    // Kept again only by someone who may still be given a territory (an
    // inactive or removed card returns it instead — independent review,
    // 17 November 2026).
    if (dto.again && a.publisherId) {
      const card = await this.publishers.findOne({
        where: { id: a.publisherId, congregationId: a.congregationId },
        select: { id: true, isActive: true, removedAt: true },
      });
      if (!card || card.removedAt || !card.isActive) {
        throw new BadRequestException(
          refusal(
            'PERSON_NOT_ASSIGNABLE',
            'This person cannot be given a task at the moment.',
          ),
        );
      }
      await assertAssignable(this.assignments.manager, a.congregationId, [
        a.publisherId,
      ]);
    }
    let saved!: TerritoryAssignment;
    try {
      saved = await this.assignments.manager.transaction(async (m) => {
        const done = await m.save(a);
        if (dto.again) {
          again = await m.save(
            m.create(TerritoryAssignment, {
              congregationId: a.congregationId,
              territoryId: a.territoryId,
              publisherId: a.publisherId,
              holderName: a.holderName,
              forGroupId: a.forGroupId,
              forGroupName: a.forGroupName,
              assignedOn: on,
              dueOn: addDays(on, TERM_DAYS),
              completedOn: null,
              returnedOn: null,
              method: null,
              extended: false,
              transferred: false,
              imported: false,
              createdByUserId: user.id,
            }),
          );
        }
        return done;
      });
    } catch (e) {
      // Pressed twice: the second finds the new line already open.
      this.refused(e);
    }
    await this.forgetMarks(saved.id);
    await this.log(user, saved, 'UPDATE', {
      completedOn: on,
      method: a.method,
      ...(dto.again ? { again: true } : {}),
    });
    if (again) {
      await this.log(user, again, 'CREATE', {
        assignedOn: on,
        dueOn: (again as TerritoryAssignment).dueOn,
        again: true,
      });
    }
    await this.releaseMeetings(user, saved.territoryId);
    return again ?? saved;
  }

  async giveBack(
    user: AuthenticatedUser,
    id: string,
    dto: ReturnAssignmentDto,
  ) {
    const { a, keeps } = await this.openFor(user, id);
    // Returning a territory unworked is the keepers' decision, after a word
    // with the holder (17 November 2026): the holder has taken it on; the
    // book knows only «worked, reported, kept or returned» (ch. 9 §33).
    if (!keeps) {
      throw new ForbiddenException(
        refusal(
          'TERRITORY_ASK_KEEPER',
          'Talk to the territory servant: only he takes a territory back unworked.',
        ),
      );
    }
    const today = await this.today(user.congregationId);
    const on = dto.returnedOn ?? today;
    if (on > today) throw this.dates('returned in the future');
    if (on < a.assignedOn) throw this.dates('returned before given out');
    a.returnedOn = on;
    const saved = await this.assignments.save(a);
    await this.forgetMarks(saved.id);
    await this.log(user, saved, 'UPDATE', { returnedOn: on });
    await this.releaseMeetings(user, saved.territoryId);
    return saved;
  }

  /**
   * «Нужно ещё время»: the holder once, for a month from the day it is due;
   * after that only a keeper, to any later day.
   */
  async extend(user: AuthenticatedUser, id: string, dto: ExtendAssignmentDto) {
    const { a, keeps } = await this.openFor(user, id);
    // A month from the day it is due — or from today, when that day has
    // already passed: a month added to a day long gone is still overdue
    // (12 November 2026, found on the brought-over records).
    const today = await this.today(user.congregationId);
    const dueDay = a.dueOn ?? addDays(a.assignedOn, TERM_DAYS);
    const due = dueDay < today ? today : dueDay;
    let next: string;
    if (keeps && dto.dueOn) {
      next = dto.dueOn;
      if (next <= a.assignedOn) throw this.dates('due before given out');
    } else {
      if (a.extended && !keeps) {
        throw new ConflictException(
          refusal(
            'TERRITORY_EXTENDED',
            'Already extended once; ask the territory servant.',
          ),
        );
      }
      next = addMonths(due, 1);
      a.extended = true;
    }
    a.dueOn = next;
    const saved = await this.assignments.save(a);
    await this.log(user, saved, 'UPDATE', { dueOn: next });
    return saved;
  }

  // ---------------------------------------------------------- corrections --

  /**
   * A keeper's line of the S-13, ended or not, while the S-13 still keeps
   * names: the current and the previous service year (17 November 2026;
   * before that only the current one — but one starts the app with the
   * paper of the year before).
   */
  private async correctable(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const a = await this.assignments.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    const today = await this.today(user.congregationId);
    const keptStart = namesKeptFrom(today);
    const end = a.completedOn ?? a.returnedOn ?? null;
    if (end !== null && end < keptStart) throw this.pastKept();
    return { a, today, keptStart };
  }

  private pastKept(): BadRequestException {
    return new BadRequestException(
      refusal(
        'TERRITORY_PAST_YEAR',
        'Only the current and the previous service year.',
      ),
    );
  }

  /** What the journal keeps of a line: enough to read it after it is gone. */
  private static facts(a: TerritoryAssignment) {
    return {
      holder: a.holderName,
      onCard: a.publisherId !== null,
      forGroup: a.forGroupName,
      assignedOn: a.assignedOn,
      dueOn: a.dueOn,
      completedOn: a.completedOn,
      returnedOn: a.returnedOn,
      method: a.method,
    };
  }

  async edit(user: AuthenticatedUser, id: string, dto: EditAssignmentDto) {
    const { a, today, keptStart } = await this.correctable(user, id);
    const tenantId = user.congregationId;
    const before = TerritoryAssignmentsService.facts(a);
    const oldPublisherId = a.publisherId;
    if (dto.reopen) {
      a.completedOn = null;
      a.returnedOn = null;
      a.method = null;
      a.transferred = false;
    }
    if (dto.assignedOn !== undefined) a.assignedOn = dto.assignedOn;
    if (dto.dueOn !== undefined) a.dueOn = dto.dueOn;
    if (dto.completedOn !== undefined) {
      a.completedOn = dto.completedOn;
      a.returnedOn = null;
      a.transferred = false;
      a.method = (dto.method as TerritoryMethod) ?? a.method ?? 'door_to_door';
    } else if (dto.method !== undefined && a.completedOn) {
      a.method = dto.method as TerritoryMethod;
    }
    if (dto.returnedOn !== undefined) {
      a.returnedOn = dto.returnedOn;
      a.completedOn = null;
      a.method = null;
    }
    const end = a.completedOn ?? a.returnedOn;
    const open = !end;
    // Who held it: a card, a name by hand, the group.
    let holder: Holder | null = null;
    // The same card again is no change of holder: only the group may move,
    // and the name stays as the S-13 wrote it (review of 17 November 2026).
    const newCard =
      dto.publisherId !== undefined && dto.publisherId !== a.publisherId;
    if (newCard || dto.holderName !== undefined) {
      const toCard = dto.publisherId !== undefined;
      holder = await this.holderOf(
        tenantId,
        {
          publisherId: toCard ? dto.publisherId : null,
          holderName: toCard ? undefined : dto.holderName,
          forGroupId:
            dto.forGroupId !== undefined ? dto.forGroupId : a.forGroupId,
        },
        open && dto.publisherId !== oldPublisherId,
        a,
      );
      a.publisherId = holder.publisherId;
      a.holderName = holder.holderName;
      a.forGroupId = holder.forGroupId;
      a.forGroupName = holder.forGroupName;
    } else if (
      dto.forGroupId !== undefined &&
      dto.forGroupId !== a.forGroupId
    ) {
      // Only whose territory it was: his own or his group's.
      const group = dto.forGroupId
        ? await this.groups.findOne({
            where: { id: dto.forGroupId, congregationId: tenantId },
          })
        : null;
      if (dto.forGroupId && !group) {
        throw new NotFoundException('Group not found');
      }
      a.forGroupId = group?.id ?? null;
      a.forGroupName = group?.name ?? null;
    }
    // A territory in hand with a new holder: the old holder's link without
    // login and his paper map in the queue are his, not the new one's.
    if (open && a.publisherId !== oldPublisherId) {
      a.linkHash = null;
      a.linkCreatedAt = null;
      a.paperWantedAt = null;
    }
    if (open && a.publisherId === null) {
      // A territory in someone's hands is his to mark worked; a name by hand
      // could never do it.
      throw new BadRequestException(
        refusal('PERSON_NOT_ASSIGNABLE', 'Someone in the list holds it now.'),
      );
    }
    if (a.assignedOn > today || (end && end > today)) {
      throw this.dates('future');
    }
    if (end && end < a.assignedOn) throw this.dates('ends before it starts');
    if (end && end < keptStart) throw this.pastKept();
    if (a.dueOn && a.dueOn <= a.assignedOn) {
      throw this.dates('due before given out');
    }
    // Moved dates must not lie over another line of the same territory: the
    // S-13 would show two people holding it at once (12 November 2026).
    if (
      await this.liesOver(
        a.congregationId,
        a.territoryId,
        a.assignedOn,
        end,
        a.id,
      )
    ) {
      throw this.overlaps();
    }
    let saved: TerritoryAssignment;
    try {
      saved = await this.assignments.save(a);
      if (a.completedOn || a.returnedOn) await this.forgetMarks(a.id);
    } catch (e) {
      this.refused(e);
    }
    const t = await this.territories.findOne({
      where: { id: a.territoryId, congregationId: tenantId },
      select: { id: true, number: true },
    });
    const after = TerritoryAssignmentsService.facts(saved);
    // «Сохранить» with nothing changed is no correction: the journal and
    // «Что происходит» stay quiet (found on the stand, 17 November 2026).
    if (JSON.stringify(before) === JSON.stringify(after)) return saved;
    await this.log(user, saved, 'UPDATE', {
      number: t?.number,
      correction: true,
      before,
      after,
    });
    await this.releaseMeetings(user, saved.territoryId);
    if (open && saved.publisherId !== oldPublisherId) {
      await this.answerRequest(tenantId, saved, user.id);
    }
    // The territory in someone's hands has a new holder: he is told, as when
    // it is given out. Corrections of the past tell nobody.
    if (open && saved.publisherId !== oldPublisherId && holder?.userId && t) {
      await this.notifications.notify({
        tenantId,
        userIds: [holder.userId],
        kind: 'territory_assigned',
        key: `territory-assigned:${saved.id}:${saved.publisherId}`,
        text: (lang) => assignedWords(t.number, saved.dueOn, lang),
        data: { type: 'territory', territoryId: t.id },
      });
    }
    return saved;
  }

  /**
   * A line of the S-13 from before the app (17 November 2026): «начать учёт
   * с бумаги». From the start of the previous service year; it may still be
   * in his hands. Nobody is told — it is the record catching up, not a
   * territory given out today.
   */
  async addPast(
    user: AuthenticatedUser,
    territoryId: string,
    dto: PastAssignmentDto,
  ) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const t = await this.territories.findOne({
      where: {
        id: territoryId,
        congregationId: tenantId,
        archivedAt: IsNull(),
      },
    });
    if (!t) throw new NotFoundException('Territory not found');
    const today = await this.today(tenantId);
    const keptStart = namesKeptFrom(today);
    const open = dto.end === 'open';
    const end = open ? null : (dto.endedOn ?? null);
    if (!open && !end) throw this.dates('no end');
    if (dto.assignedOn > today || (end && end > today)) {
      throw this.dates('future');
    }
    if (dto.assignedOn < keptStart) throw this.pastKept();
    if (end && end < dto.assignedOn) throw this.dates('ends before it starts');
    const dueOn = dto.dueOn ?? addDays(dto.assignedOn, TERM_DAYS);
    if (dueOn <= dto.assignedOn) throw this.dates('due before given out');
    const holder = await this.holderOf(
      tenantId,
      {
        publisherId: dto.publisherId ?? null,
        holderName: dto.holderName,
        forGroupId: dto.forGroupId ?? null,
      },
      open,
    );
    if (open && holder.publisherId === null) {
      throw new BadRequestException(
        refusal('PERSON_NOT_ASSIGNABLE', 'Someone in the list holds it now.'),
      );
    }
    if (await this.liesOver(tenantId, t.id, dto.assignedOn, end)) {
      throw this.overlaps();
    }
    let saved!: TerritoryAssignment;
    try {
      saved = await this.assignments.manager.transaction(async (m) => {
        if (open) {
          // Held now: the same locks as giving it out (a join of the
          // re-cutting draft may be holding it back).
          const [still] = await m.query<{ id: string }[]>(
            `SELECT id FROM territories
              WHERE id = $1 AND congregation_id = $2 AND archived_at IS NULL
              FOR SHARE`,
            [t.id, tenantId],
          );
          if (!still) throw new NotFoundException('Territory not found');
          await mustNotBeHeldBack(m, tenantId, t.id, t.number, false);
        }
        return m.save(
          m.create(TerritoryAssignment, {
            congregationId: tenantId,
            territoryId: t.id,
            publisherId: holder.publisherId,
            holderName: holder.holderName,
            forGroupId: holder.forGroupId,
            forGroupName: holder.forGroupName,
            assignedOn: dto.assignedOn,
            dueOn,
            completedOn: dto.end === 'completed' ? end : null,
            returnedOn: dto.end === 'returned' ? end : null,
            method:
              dto.end === 'completed'
                ? ((dto.method as TerritoryMethod) ?? 'door_to_door')
                : null,
            extended: false,
            transferred: false,
            // Not «imported»: a new import of the S-13 replaces the lines it
            // brought, and must keep what the keeper entered by hand.
            imported: false,
            createdByUserId: user.id,
          }),
        );
      });
    } catch (e) {
      this.refused(e);
    }
    await this.log(user, saved, 'CREATE', {
      number: t.number,
      past: true,
      ...TerritoryAssignmentsService.facts(saved),
    });
    if (open) {
      await this.releaseMeetings(user, t.id);
      await this.answerRequest(tenantId, saved, user.id);
    }
    return saved;
  }

  /** A line entered by mistake (while the S-13 keeps names). */
  async remove(user: AuthenticatedUser, id: string) {
    const { a } = await this.correctable(user, id);
    const t = await this.territories.findOne({
      where: { id: a.territoryId, congregationId: user.congregationId },
      select: { id: true, number: true },
    });
    // A line made by handing on, removed as a mistake: the walk marks it
    // took over go back to the line it came from (review of 17 November
    // 2026) — the line itself is reopened by correcting it.
    const from = await this.assignments.findOne({
      where: {
        congregationId: a.congregationId,
        territoryId: a.territoryId,
        transferred: true,
        returnedOn: a.assignedOn,
      },
      order: { createdAt: 'DESC' },
    });
    await this.assignments.manager.transaction(async (m) => {
      if (from && from.createdAt < a.createdAt) {
        for (const table of [
          TerritoryStreetMark,
          TerritoryBusinessVisit,
          TerritorySplit,
        ]) {
          await m.update(
            table,
            { assignmentId: a.id },
            { assignmentId: from.id },
          );
        }
      }
      await m.delete(TerritoryAssignment, { id: a.id });
    });
    await this.log(user, a, 'DELETE', {
      number: t?.number,
      ...TerritoryAssignmentsService.facts(a),
    });
    await this.releaseMeetings(user, a.territoryId);
    return { ok: true };
  }

  // ------------------------------------------------- meetings for service --

  /** What a meeting may go out to: its conductor's own, or its group's. */
  private async meetingOptions(m: FieldServiceMeeting) {
    const open = { completedOn: IsNull(), returnedOn: IsNull() };
    const where = [
      ...(m.conductorPublisherId
        ? [
            {
              congregationId: m.congregationId,
              publisherId: m.conductorPublisherId,
              ...open,
            },
          ]
        : []),
      ...(m.serviceGroupId
        ? [
            {
              congregationId: m.congregationId,
              forGroupId: m.serviceGroupId,
              ...open,
            },
          ]
        : []),
    ];
    if (where.length === 0) return [];
    const held = await this.assignments.find({ where });
    const ids = [...new Set(held.map((a) => a.territoryId))];
    if (ids.length === 0) return [];
    const terr = await this.territories.find({
      where: {
        id: In(ids),
        congregationId: m.congregationId,
        archivedAt: IsNull(),
      },
      select: { id: true, number: true, locality: true },
      order: { number: 'ASC' },
    });
    return terr.map((t) => ({
      territoryId: t.id,
      number: t.number,
      locality: t.locality,
    }));
  }

  /** The meeting's territory is still one it may go out to. */
  private async meetingStillHolds(m: FieldServiceMeeting): Promise<boolean> {
    if (!m.territoryId) return false;
    return (await this.meetingOptions(m)).some(
      (o) => o.territoryId === m.territoryId,
    );
  }

  /**
   * After a territory changed hands (12 November 2026): the meetings from
   * today on that were sent to it and may no longer go there lose it, and
   * their conductor is told once. Called after the change is saved.
   */
  private async releaseMeetings(
    user: AuthenticatedUser,
    territoryId: string,
  ): Promise<void> {
    const tenantId = user.congregationId;
    const c = await this.congregations.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });
    const now = new Date();
    const today = todayIn(now, c?.timezone);
    const nowMinutes = minutesOfDayIn(now, c?.timezone);
    const rows = await this.meetings.find({
      where: {
        congregationId: tenantId,
        territoryId,
        cancelledAt: IsNull(),
        weekStartDate: MoreThanOrEqual(mondayOf(today)),
      },
    });
    if (rows.length === 0) return;
    const t = await this.territories.findOne({
      where: { id: territoryId, congregationId: tenantId },
      select: { id: true, number: true },
    });
    for (const m of rows) {
      const date = addDays(m.weekStartDate, m.dayOfWeek - 1);
      // A meeting that has already begun went out to it: its record stays.
      if (meetingHasBegun(date, m.startTime, today, nowMinutes)) continue;
      if (await this.meetingStillHolds(m)) continue;
      await this.meetings.update({ id: m.id }, { territoryId: null });
      await this.audit.logFact({
        tenantId,
        entityType: 'territory_assignment',
        entityId: m.id,
        action: 'UPDATE',
        actorUserId: user.id,
        detail: {
          meeting: m.id,
          territoryId: null,
          droppedFrom: territoryId,
          date,
        },
      });
      const conductor = m.conductorPublisherId
        ? await this.publishers.findOne({
            where: { id: m.conductorPublisherId, congregationId: tenantId },
            select: { id: true, userId: true },
          })
        : null;
      if (conductor?.userId && t) {
        await this.notifications.notify({
          tenantId,
          userIds: [conductor.userId],
          kind: 'territory_meeting_dropped',
          key: `territory-meeting-dropped:${m.id}:${territoryId}`,
          text: (lang) => meetingDroppedWords(t.number, date, lang),
          data: { type: 'territory', territoryId },
        });
      }
    }
  }

  /**
   * The meetings for field service the user conducts in the next two weeks,
   * each with the territories he may send it to (his own, his group's).
   */
  async myMeetings(user: AuthenticatedUser) {
    const verified =
      (await this.access.verifiedAt(user.congregationId)) !== null;
    if (!verified) return [];
    const me = await this.access.person(user);
    if (!me.publisherId) return [];
    const today = await this.today(user.congregationId);
    const until = addDays(today, 14);
    const rows = await this.meetings.find({
      where: {
        congregationId: user.congregationId,
        conductorPublisherId: me.publisherId,
        cancelledAt: IsNull(),
        weekStartDate: MoreThanOrEqual(mondayOf(today)),
      },
    });
    const out: {
      id: string;
      date: string;
      startTime: string;
      address: string;
      serviceGroupId: string | null;
      territoryId: string | null;
      /** Sent to a territory it may no longer go to (another's now). */
      dropped: { number: string } | null;
      options: {
        territoryId: string;
        number: string;
        locality: string | null;
      }[];
    }[] = [];
    for (const m of rows) {
      const date = addDays(m.weekStartDate, m.dayOfWeek - 1);
      if (date < today || date > until) continue;
      const options = await this.meetingOptions(m);
      const holds =
        !!m.territoryId && options.some((o) => o.territoryId === m.territoryId);
      let dropped: { number: string } | null = null;
      if (m.territoryId && !holds) {
        const t = await this.territories.findOne({
          where: { id: m.territoryId, congregationId: user.congregationId },
          select: { id: true, number: true },
        });
        dropped = t ? { number: t.number } : null;
      }
      out.push({
        id: m.id,
        date,
        startTime: m.startTime,
        address: m.address,
        serviceGroupId: m.serviceGroupId,
        territoryId: holds ? m.territoryId : null,
        dropped,
        options,
      });
    }
    return out.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );
  }

  /** The meeting's conductor (or a keeper) sends it to a territory, or none. */
  async setMeetingTerritory(
    user: AuthenticatedUser,
    meetingId: string,
    territoryId: string | null,
  ) {
    const verified =
      (await this.access.verifiedAt(user.congregationId)) !== null;
    if (!verified) throw this.notOpen();
    const m = await this.meetings.findOne({
      where: { id: meetingId, congregationId: user.congregationId },
    });
    if (!m) throw new NotFoundException('Meeting not found');
    const access = await this.access.of(user);
    const me = await this.access.person(user);
    const conducts =
      !!me.publisherId && m.conductorPublisherId === me.publisherId;
    if (!conducts && !access.keeps) {
      throw new NotFoundException('Meeting not found');
    }
    const today = await this.today(user.congregationId);
    const date = addDays(m.weekStartDate, m.dayOfWeek - 1);
    if (m.cancelledAt || date < today) {
      throw new BadRequestException(
        refusal('TERRITORY_DATES', 'The meeting is past or called off.'),
      );
    }
    if (territoryId) {
      const options = await this.meetingOptions(m);
      if (!options.some((o) => o.territoryId === territoryId)) {
        throw new BadRequestException(
          refusal(
            'TERRITORY_NOT_FOR_MEETING',
            "Only the conductor's own territory or his group's.",
          ),
        );
      }
    }
    await this.meetings.update({ id: m.id }, { territoryId });
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_assignment',
      entityId: m.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { meeting: m.id, territoryId, date },
    });
    return { id: m.id, territoryId };
  }

  // ------------------------------------------------------------ campaign --

  /**
   * «Обработаны в кампанию»: free territories worked during a campaign, all
   * at once (11 November 2026). Each gets a line in the keeper's name with
   * the method «кампания» — the S-13 writes it «фамилия (кампания)». A
   * territory in someone's hands is not touched: its holder marks it worked.
   */
  async campaign(
    user: AuthenticatedUser,
    territoryIds: string[],
    workedOn?: string,
  ) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const on = workedOn ?? today;
    if (on > today) throw this.dates('worked in the future');
    if (serviceYearOf(on) < serviceYearOf(today)) {
      throw new BadRequestException(
        refusal('TERRITORY_PAST_YEAR', 'Only the current service year.'),
      );
    }
    const ids = [...new Set(territoryIds)];
    const terr = await this.territories.find({
      where: { id: In(ids), congregationId: tenantId, archivedAt: IsNull() },
    });
    if (terr.length !== ids.length) {
      throw new NotFoundException('Territory not found');
    }
    const open = await this.assignments.find({
      where: {
        congregationId: tenantId,
        territoryId: In(ids),
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
    });
    if (open.length > 0) {
      const number = terr.find((t) => t.id === open[0].territoryId)?.number;
      throw new ConflictException(
        refusal('TERRITORY_HELD', 'The territory is already given out.', {
          number,
        }),
      );
    }
    const me = await this.access.person(user);
    const card = me.publisherId
      ? await this.publishers.findOne({
          where: { id: me.publisherId, congregationId: tenantId },
        })
      : null;
    const holderName = card ? holderNameOf(card) : '—';
    for (const t of terr) {
      if (await this.liesOver(tenantId, t.id, on, on)) {
        throw new BadRequestException(
          refusal('TERRITORY_DATES', `${t.number}: before it came back`, {
            number: t.number,
          }),
        );
      }
    }
    const saved = await this.assignments.manager.transaction((m) =>
      m.save(
        terr.map((t) =>
          m.create(TerritoryAssignment, {
            congregationId: tenantId,
            territoryId: t.id,
            publisherId: card?.id ?? null,
            holderName,
            forGroupId: null,
            forGroupName: null,
            assignedOn: on,
            dueOn: null,
            completedOn: on,
            returnedOn: null,
            method: 'campaign',
            extended: false,
            imported: false,
            createdByUserId: user.id,
          }),
        ),
      ),
    );
    await this.audit.logFact({
      tenantId,
      entityType: 'territory_assignment',
      entityId: tenantId,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { campaign: terr.map((t) => t.number), workedOn: on },
    });
    return { saved: saved.length };
  }

  // --------------------------------------------------- a group's new head --

  /**
   * A territory handed on to someone else, through the keeper (17 November
   * 2026; at first only a group's territory to the group's new overseer).
   *
   * The old line ends that day as handed on («передан», `transferred`), a
   * new one starts the same day for the new holder — with the day it was due,
   * or a new one. The walk goes on: the «street walked» and «visited» marks
   * and the division between groups move to the new line. The new holder is
   * told «Вам выдан участок», the old one that it went on.
   */
  async transfer(
    user: AuthenticatedUser,
    id: string,
    dto: { toPublisherId?: string; on?: string; dueOn?: string },
  ) {
    await this.mustKeepOpen(user);
    const tenantId = user.congregationId;
    const a = await this.assignments.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    if (a.completedOn || a.returnedOn) {
      throw new ConflictException(
        refusal('TERRITORY_ENDED', 'The territory has already come back.'),
      );
    }
    const group = a.forGroupId
      ? await this.groups.findOne({
          where: { id: a.forGroupId, congregationId: tenantId },
        })
      : null;
    const toId = dto.toPublisherId ?? group?.overseerPublisherId ?? null;
    if (!toId || toId === a.publisherId) {
      throw new BadRequestException(
        refusal('PERSON_NOT_ASSIGNABLE', 'Choose who takes it on.'),
      );
    }
    const holder = await this.holderOf(
      tenantId,
      { publisherId: toId, forGroupId: a.forGroupId },
      true,
      a,
    );
    const today = await this.today(tenantId);
    const on = dto.on ?? today;
    if (on > today || on < a.assignedOn) {
      throw this.dates('handed on outside its term');
    }
    const dueOn = dto.dueOn ?? a.dueOn;
    if (dueOn && dueOn <= on) throw this.dates('due before given out');
    const t = await this.territories.findOne({
      where: { id: a.territoryId, congregationId: tenantId },
    });
    const oldPublisherId = a.publisherId;
    let next!: TerritoryAssignment;
    try {
      next = await this.assignments.manager.transaction(async (m) => {
        await m.update(
          TerritoryAssignment,
          { id: a.id },
          { returnedOn: on, transferred: true, paperWantedAt: null },
        );
        const made = await m.save(
          m.create(TerritoryAssignment, {
            congregationId: tenantId,
            territoryId: a.territoryId,
            publisherId: holder.publisherId,
            holderName: holder.holderName,
            forGroupId: a.forGroupId,
            forGroupName: group?.name ?? a.forGroupName,
            assignedOn: on,
            dueOn,
            completedOn: null,
            returnedOn: null,
            method: null,
            // A new day due is a new term; the old one carries its extension.
            extended: dto.dueOn ? false : a.extended,
            transferred: false,
            imported: false,
            createdByUserId: user.id,
          }),
        );
        for (const table of [
          TerritoryStreetMark,
          TerritoryBusinessVisit,
          TerritorySplit,
        ]) {
          await m.update(
            table,
            { assignmentId: a.id },
            { assignmentId: made.id },
          );
        }
        return made;
      });
    } catch (e) {
      this.refused(e);
    }
    await this.log(user, next, 'CREATE', {
      number: t?.number,
      transferredFrom: a.id,
      fromHolder: a.holderName,
      on,
      ...TerritoryAssignmentsService.facts(next),
    });
    await this.releaseMeetings(user, a.territoryId);
    await this.answerRequest(tenantId, next, user.id);
    if (t && holder.userId) {
      await this.notifications.notify({
        tenantId,
        userIds: [holder.userId],
        kind: 'territory_assigned',
        key: `territory-assigned:${next.id}`,
        text: (lang) => assignedWords(t.number, next.dueOn, lang),
        data: { type: 'territory', territoryId: t.id },
      });
    }
    const old = oldPublisherId
      ? await this.publishers.findOne({
          where: { id: oldPublisherId, congregationId: tenantId },
          select: { id: true, userId: true },
        })
      : null;
    if (t && old?.userId) {
      await this.notifications.notify({
        tenantId,
        userIds: [old.userId],
        kind: 'territory_transferred',
        key: `territory-transferred:${a.id}`,
        text: (lang) => handedOnWords(t.number, lang),
        data: { type: 'territory' },
      });
    }
    return next;
  }

  /**
   * Every step of a line goes to the journal with the territory's number and
   * the holder as written on the S-13 (17 November 2026): «Что происходит»
   * reads them without asking anything else, and still can after the line
   * itself is gone.
   */
  private async log(
    user: AuthenticatedUser,
    a: TerritoryAssignment,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    detail: Record<string, unknown>,
  ) {
    const number =
      detail.number ??
      (
        await this.territories.findOne({
          where: { id: a.territoryId, congregationId: user.congregationId },
          select: { id: true, number: true },
        })
      )?.number;
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_assignment',
      entityId: a.id,
      action,
      actorUserId: user.id,
      detail: {
        territoryId: a.territoryId,
        holder: a.holderName,
        forGroup: a.forGroupName,
        ...detail,
        number,
      },
    });
  }
}

/** The Monday of a 'YYYY-MM-DD' week. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDays(iso, 1 - dow);
}
