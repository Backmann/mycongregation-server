import {
  BadRequestException,
  ConflictException,
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
import { Publisher } from '../entities/publisher.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { FieldServiceMeeting } from '../entities/field-service-meeting.entity';
import { Congregation } from '../entities/congregation.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assignedWords } from './territory-words';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { assertAssignable } from '../common/inactive';
import { todayIn } from '../common/congregation-clock';
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
  ReturnAssignmentDto,
} from './dto/assignment.dto';

const PG_UNIQUE_VIOLATION = '23505';

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
  ) {}

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
    return rows
      .map((m) => ({ m, date: addDays(m.weekStartDate, m.dayOfWeek - 1) }))
      .filter(({ date }) => date === today || date === tomorrow)
      .filter(
        ({ m }) =>
          !m.serviceGroupId ||
          m.serviceGroupId === me.memberOf ||
          me.oversees.includes(m.serviceGroupId) ||
          m.conductorPublisherId === me.publisherId,
      )
      .map(({ m, date }) => ({
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
    return rows
      .filter((a) => byId.has(a.territoryId))
      .map((a) => {
        const t = byId.get(a.territoryId)!;
        const m = meetingOf.get(t.id);
        return {
          id: t.id,
          number: t.number,
          locality: t.locality,
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
        };
      }),
    };
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
    const last = await this.assignments.findOne({
      where: { territoryId: t.id, congregationId: tenantId },
      order: { assignedOn: 'DESC' },
    });
    const lastEnd = last?.completedOn ?? last?.returnedOn ?? null;
    if (lastEnd && assignedOn < lastEnd) {
      throw this.dates('given out before it came back');
    }
    const dueOn = dto.dueOn ?? addDays(assignedOn, TERM_DAYS);
    if (dueOn <= assignedOn) throw this.dates('due before given out');
    let saved: TerritoryAssignment;
    try {
      saved = await this.assignments.save(
        this.assignments.create({
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
    } catch (e) {
      if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          refusal('TERRITORY_HELD', 'The territory is already given out.'),
        );
      }
      throw e;
    }
    await this.log(user, saved, 'CREATE', {
      number: t.number,
      assignedOn,
      dueOn,
      forGroup: group?.name ?? null,
    });
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
    const saved = await this.assignments.save(a);
    await this.log(user, saved, 'UPDATE', {
      completedOn: on,
      method: a.method,
    });
    return saved;
  }

  async giveBack(
    user: AuthenticatedUser,
    id: string,
    dto: ReturnAssignmentDto,
  ) {
    const { a } = await this.openFor(user, id);
    const today = await this.today(user.congregationId);
    const on = dto.returnedOn ?? today;
    if (on > today) throw this.dates('returned in the future');
    if (on < a.assignedOn) throw this.dates('returned before given out');
    a.returnedOn = on;
    const saved = await this.assignments.save(a);
    await this.log(user, saved, 'UPDATE', { returnedOn: on });
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

  /** A keeper's assignment of the current service year, ended or not. */
  private async correctable(user: AuthenticatedUser, id: string) {
    await this.mustKeepOpen(user);
    const a = await this.assignments.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    const today = await this.today(user.congregationId);
    const yearStart = serviceYearStart(serviceYearOf(today));
    const end = a.completedOn ?? a.returnedOn ?? null;
    if (end !== null && end < yearStart) {
      throw new BadRequestException(
        refusal('TERRITORY_PAST_YEAR', 'Only the current service year.'),
      );
    }
    return { a, today, yearStart };
  }

  async edit(user: AuthenticatedUser, id: string, dto: EditAssignmentDto) {
    const { a, today, yearStart } = await this.correctable(user, id);
    const before = {
      assignedOn: a.assignedOn,
      dueOn: a.dueOn,
      completedOn: a.completedOn,
      returnedOn: a.returnedOn,
      method: a.method,
    };
    if (dto.reopen) {
      a.completedOn = null;
      a.returnedOn = null;
      a.method = null;
    }
    if (dto.assignedOn !== undefined) a.assignedOn = dto.assignedOn;
    if (dto.dueOn !== undefined) a.dueOn = dto.dueOn;
    if (dto.completedOn !== undefined) {
      a.completedOn = dto.completedOn;
      a.returnedOn = null;
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
    if (a.assignedOn > today || (end && end > today)) {
      throw this.dates('future');
    }
    if (end && end < a.assignedOn) throw this.dates('ends before it starts');
    if (end && end < yearStart) {
      throw new BadRequestException(
        refusal('TERRITORY_PAST_YEAR', 'Only the current service year.'),
      );
    }
    if (a.dueOn && a.dueOn <= a.assignedOn) {
      throw this.dates('due before given out');
    }
    // Moved dates must not lie over another line of the same territory: the
    // S-13 would show two people holding it at once (12 November 2026). A
    // line may start the day the one before it ended.
    const others = await this.assignments.find({
      where: { territoryId: a.territoryId, congregationId: a.congregationId },
    });
    const FAR = '9999-12-31';
    const aEnd = end ?? FAR;
    if (
      others.some((o) => {
        if (o.id === a.id) return false;
        const oEnd = o.completedOn ?? o.returnedOn ?? FAR;
        return o.assignedOn < aEnd && oEnd > a.assignedOn;
      })
    ) {
      throw this.dates('lies over another line of this territory');
    }
    let saved: TerritoryAssignment;
    try {
      saved = await this.assignments.save(a);
    } catch (e) {
      if ((e as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          refusal('TERRITORY_HELD', 'The territory is already given out.'),
        );
      }
      throw e;
    }
    await this.log(user, saved, 'UPDATE', { before, after: dto });
    return saved;
  }

  /** A line entered by mistake (current service year only). */
  async remove(user: AuthenticatedUser, id: string) {
    const { a } = await this.correctable(user, id);
    await this.assignments.delete({ id: a.id });
    await this.log(user, a, 'DELETE', {
      assignedOn: a.assignedOn,
      holder: a.holderName,
    });
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
      options: {
        territoryId: string;
        number: string;
        locality: string | null;
      }[];
    }[] = [];
    for (const m of rows) {
      const date = addDays(m.weekStartDate, m.dayOfWeek - 1);
      if (date < today || date > until) continue;
      out.push({
        id: m.id,
        date,
        startTime: m.startTime,
        address: m.address,
        serviceGroupId: m.serviceGroupId,
        territoryId: m.territoryId,
        options: await this.meetingOptions(m),
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
      const last = await this.assignments.findOne({
        where: { territoryId: t.id, congregationId: tenantId },
        order: { assignedOn: 'DESC' },
      });
      const lastEnd = last?.completedOn ?? last?.returnedOn ?? null;
      if (lastEnd && on < lastEnd) {
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
   * A group's territory still held by someone who no longer oversees that
   * group (11 November 2026): the keeper passes it on — the old line ends as
   * returned, a new one starts for the group's overseer on the same day and
   * keeps the day it is due.
   */
  async transfer(
    user: AuthenticatedUser,
    id: string,
    dto: { toPublisherId?: string; on?: string },
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
    const p = await this.publishers.findOne({
      where: { id: toId, congregationId: tenantId },
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
    const today = await this.today(tenantId);
    const on = dto.on ?? today;
    if (on > today || on < a.assignedOn) {
      throw this.dates('handed on outside its term');
    }
    const t = await this.territories.findOne({
      where: { id: a.territoryId, congregationId: tenantId },
    });
    const next = await this.assignments.manager.transaction(async (m) => {
      await m.update(TerritoryAssignment, { id: a.id }, { returnedOn: on });
      return m.save(
        m.create(TerritoryAssignment, {
          congregationId: tenantId,
          territoryId: a.territoryId,
          publisherId: p.id,
          holderName: holderNameOf(p),
          forGroupId: a.forGroupId,
          forGroupName: group?.name ?? a.forGroupName,
          assignedOn: on,
          dueOn: a.dueOn,
          completedOn: null,
          returnedOn: null,
          method: null,
          extended: a.extended,
          imported: false,
          createdByUserId: user.id,
        }),
      );
    });
    await this.log(user, next, 'CREATE', {
      transferredFrom: a.id,
      on,
      number: t?.number,
    });
    if (p.userId && t) {
      await this.notifications.notify({
        tenantId,
        userIds: [p.userId],
        kind: 'territory_assigned',
        key: `territory-assigned:${next.id}`,
        text: (lang) => assignedWords(t.number, next.dueOn, lang),
        data: { type: 'territory', territoryId: t.id },
      });
    }
    return next;
  }

  private async log(
    user: AuthenticatedUser,
    a: TerritoryAssignment,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    detail: Record<string, unknown>,
  ) {
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_assignment',
      entityId: a.id,
      action,
      actorUserId: user.id,
      detail: { territoryId: a.territoryId, ...detail },
    });
  }
}

/** The Monday of a 'YYYY-MM-DD' week. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDays(iso, 1 - dow);
}
