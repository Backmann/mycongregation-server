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
import { Congregation } from '../entities/congregation.entity';
import { PublisherStatus } from '../common/enums/publisher-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
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

  private async visibleTo(congregationId: string, me: TerritoryPerson) {
    if (!me.publisherId) return [];
    const groupIds = [
      ...new Set([...me.oversees, ...(me.memberOf ? [me.memberOf] : [])]),
    ];
    const open = { completedOn: IsNull(), returnedOn: IsNull() };
    const rows = await this.assignments.find({
      where: [
        { congregationId, publisherId: me.publisherId, ...open },
        ...(groupIds.length
          ? [{ congregationId, forGroupId: In(groupIds), ...open }]
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
    const due = a.dueOn ?? addDays(a.assignedOn, TERM_DAYS);
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
