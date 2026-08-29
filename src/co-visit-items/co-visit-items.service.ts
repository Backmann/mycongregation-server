import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { isActivePermanentPioneer } from '../common/pioneer-status';
import { AuxiliaryPioneersService } from '../auxiliary-pioneers/auxiliary-pioneers.service';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CongregationClock } from '../common/congregation-clock.service';

/**
 * The field-service part of a circuit-overseer visit, as everyone may see it.
 *
 * The visit's own item list is elder-only, and rightly so: it also holds who
 * hosts the overseer, home addresses and phone numbers. But the field-service
 * meetings of that week are announced to the whole congregation like any
 * other, and during a visit they live HERE rather than in the regular field
 * service section — so without this the week looked empty to everybody.
 *
 * Only what an announcement would carry: when and where. Deliberately NOT the
 * assignee: on a visit item that field holds the brother going out in service
 * WITH the overseer, not the one conducting the meeting — publishing it as a
 * conductor stated something untrue and exposed a personal pairing to the
 * whole congregation. No assignee, no ids, no phones, no addresses, no notes.
 */
export interface CoVisitFieldServiceMeeting {
  id: string;
  itemDate: string;
  startTime: string | null;
  place: string | null;
}

/**
 * One session of field service is stored as more than one row: the overseer's
 * row and a paired row for his wife, same day and time. The schedule screen
 * folds that pair into a single line; the public view must too, or the same
 * outing is announced twice. Rows that genuinely differ — a separate outing at
 * another time or from another place — stay apart, because then they really
 * are different meetings.
 */
function collapse(
  items: {
    id: string;
    itemDate: string;
    startTime: string | null;
    placeKind: string | null;
    placeText: string | null;
    cartLocation?: { name: string } | null;
  }[],
): CoVisitFieldServiceMeeting[] {
  const seen = new Map<string, CoVisitFieldServiceMeeting>();
  for (const it of items) {
    const place =
      (it.placeKind === 'cart_location'
        ? (it.cartLocation?.name ?? null)
        : (it.placeText ?? null)) ?? null;
    const key = `${it.itemDate}|${it.startTime ?? ''}|${place ?? ''}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: it.id,
      itemDate: it.itemDate,
      startTime: it.startTime ?? null,
      place,
    });
  }
  return [...seen.values()];
}

export interface CoVisitFieldServiceWeek {
  visit: { id: string; title: string; date: string; endDate: string | null };
  meetings: CoVisitFieldServiceMeeting[];
}

export interface CoVisitItemView {
  id: string;
  kind: string;
  forWife: boolean;
  withWife: boolean;
  itemDate: string;
  startTime: string | null;
  placeKind: string | null;
  cartLocationId: string | null;
  cartLocationName: string | null;
  placeText: string | null;
  assigneePublisherId: string | null;
  assigneeName: string | null;
  assigneePhone: string | null;
  assigneeAddress: string | null;
  assigneeText: string | null;
  note: string | null;
  sortOrder: number;
}

/**
 * Pure mapper: entity (with assignee + cartLocation relations loaded) -> the
 * view sent to the client. Names are public; the assignee's phone/address are
 * private data and included only when `canViewPrivate` is true.
 */
export function toCoVisitItemView(
  item: CoVisitItem,
  canViewPrivate: boolean,
): CoVisitItemView {
  const a = item.assignee;
  return {
    id: item.id,
    kind: item.kind,
    forWife: item.forWife,
    withWife: item.withWife,
    itemDate: item.itemDate,
    startTime: item.startTime,
    placeKind: item.placeKind,
    cartLocationId: item.cartLocationId,
    cartLocationName: item.cartLocation?.name ?? null,
    placeText: item.placeText,
    assigneePublisherId: item.assigneePublisherId,
    assigneeName: a ? `${a.lastName} ${a.firstName}`.trim() : null,
    assigneePhone: canViewPrivate ? (a?.mobilePhone ?? null) : null,
    assigneeAddress: canViewPrivate ? (a?.address ?? null) : null,
    assigneeText: item.assigneeText,
    note: item.note,
    sortOrder: item.sortOrder,
  };
}

@Injectable()
export class CoVisitItemsService {
  constructor(
    @InjectRepository(CoVisitItem)
    private readonly repo: Repository<CoVisitItem>,
    @InjectRepository(SpecialEvent)
    private readonly eventsRepo: Repository<SpecialEvent>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auxiliaryPioneersService: AuxiliaryPioneersService,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * The signed-in person's own slice of upcoming circuit-overseer visits,
   * readable by ANY authenticated member (unlike the full schedule):
   *   • items where they are the assignee (service partner, lunch host, …) —
   *     for a wife's separate-service row the "type of service" note is
   *     inherited from the overseer's paired row;
   *   • the pioneer meeting for every pioneer — active permanent pioneers
   *     (regular/special/missionary) and auxiliary pioneers serving this month;
   *   • the elders/MS meeting for elders and ministerial servants.
   * Private assignee data of other people is never included.
   */
  /**
   * Who has already done what, across ALL visits, past ones included.
   *
   * For every publisher and every KIND separately — a lunch, a lunch box, a
   * morning in the ministry, a shepherding call — the total, the last past
   * date and the next scheduled one. Kept per kind on purpose: hosting the
   * overseer for lunch three times says nothing about whether you have ever
   * gone out in the ministry with him, and rolling them together would send
   * the same few names round every time.
   *
   * This is what the pickers order by, so whoever has not been asked for the
   * longest stands at the top. It informs; it never forbids — sometimes the
   * same person really is the right one, and the choice stays with whoever is
   * planning the visit.
   */
  async hostStats(congregationId: string): Promise<
    {
      publisherId: string;
      kind: string;
      total: number;
      lastDate: string | null;
      nextDate: string | null;
    }[]
  > {
    const rows = await this.repo
      .createQueryBuilder('i')
      .select(['i.kind', 'i.itemDate', 'i.assigneePublisherId'])
      .where('i.congregationId = :congregationId', { congregationId })
      .andWhere('i.kind IN (:...kinds)', {
        kinds: ['lunch', 'lunch_box', 'field_service', 'pastoral'],
      })
      .andWhere('i.assigneePublisherId IS NOT NULL')
      .getMany();
    const today = await this.clock.todayFor(congregationId);
    const map = new Map<
      string,
      {
        publisherId: string;
        kind: string;
        total: number;
        lastDate: string | null;
        nextDate: string | null;
      }
    >();
    for (const r of rows) {
      const key = `${r.assigneePublisherId}|${r.kind}`;
      const st = map.get(key) ?? {
        publisherId: r.assigneePublisherId!,
        kind: r.kind,
        total: 0,
        lastDate: null,
        nextDate: null,
      };
      st.total += 1;
      if (r.itemDate <= today) {
        if (!st.lastDate || r.itemDate > st.lastDate) st.lastDate = r.itemDate;
      } else if (!st.nextDate || r.itemDate < st.nextDate) {
        st.nextDate = r.itemDate;
      }
      map.set(key, st);
    }

    // Accommodation is not an item — it lives on the visit itself — but the
    // question is the same one: who has already put them up, and how long ago.
    // Answered here so the picker has a single place to ask.
    const visits = await this.repo.manager
      .createQueryBuilder(SpecialEvent, 'e')
      .select(['e.date', 'e.coAccommodationPublisherId'])
      .where('e.congregationId = :congregationId', { congregationId })
      .andWhere('e.type = :type', { type: 'circuit_overseer_visit' })
      .andWhere('e.coAccommodationPublisherId IS NOT NULL')
      .getMany();
    for (const v of visits) {
      const key = `${v.coAccommodationPublisherId}|accommodation`;
      const st = map.get(key) ?? {
        publisherId: v.coAccommodationPublisherId!,
        kind: 'accommodation',
        total: 0,
        lastDate: null,
        nextDate: null,
      };
      st.total += 1;
      if (v.date <= today) {
        if (!st.lastDate || v.date > st.lastDate) st.lastDate = v.date;
      } else if (!st.nextDate || v.date < st.nextDate) {
        st.nextDate = v.date;
      }
      map.set(key, st);
    }
    return Array.from(map.values());
  }

  /**
   * Field-service meetings of every upcoming visit, for any signed-in member.
   * Deliberately narrow — see CoVisitFieldServiceMeeting for why the full item
   * list cannot simply be opened up.
   */
  async fieldService(
    congregationId: string,
  ): Promise<CoVisitFieldServiceWeek[]> {
    const today = await this.clock.todayFor(congregationId);
    const visits = (
      await this.eventsRepo.find({
        where: { congregationId, type: 'circuit_overseer_visit' },
        order: { date: 'ASC' },
      })
    ).filter((e) => (e.endDate ?? e.date) >= today);

    const out: CoVisitFieldServiceWeek[] = [];
    for (const visit of visits) {
      const items = await this.repo.find({
        where: {
          congregationId,
          specialEventId: visit.id,
          kind: 'field_service',
        },
        relations: { assignee: true, cartLocation: true },
        order: { itemDate: 'ASC', startTime: 'ASC', sortOrder: 'ASC' },
      });
      if (items.length === 0) continue;
      out.push({
        visit: {
          id: visit.id,
          title: visit.title,
          date: visit.date,
          endDate: visit.endDate ?? null,
        },
        meetings: collapse(items),
      });
    }
    return out;
  }

  async mine(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<
    {
      visit: {
        id: string;
        title: string;
        date: string;
        endDate: string | null;
      };
      items: (CoVisitItemView & { serviceWith?: 'co' | 'wife' | 'joint' })[];
    }[]
  > {
    const publisher = await this.publishersRepo.findOne({
      where: { congregationId, userId: user.id },
    });
    if (!publisher) return [];
    // The pioneer meeting is for every kind of pioneer: any active permanent
    // pioneer (regular / special / missionary) OR an auxiliary pioneer serving
    // this month. It concerns all of them directly.
    const today = await this.clock.todayFor(congregationId);
    const isAuxNow =
      await this.auxiliaryPioneersService.isActiveAuxiliaryPioneer(
        congregationId,
        publisher.id,
        today,
      );
    const isPioneer =
      isActivePermanentPioneer(publisher.pioneerType, publisher.pioneerSince) ||
      isAuxNow;
    const isAppointed =
      publisher.appointment === PublisherAppointment.ELDER ||
      publisher.appointment === PublisherAppointment.MINISTERIAL_SERVANT;

    const visits = (
      await this.eventsRepo.find({
        where: { congregationId, type: 'circuit_overseer_visit' },
        order: { date: 'ASC' },
      })
    ).filter((e) => (e.endDate ?? e.date) >= today);
    if (visits.length === 0) return [];

    const out: {
      visit: {
        id: string;
        title: string;
        date: string;
        endDate: string | null;
      };
      items: (CoVisitItemView & { serviceWith?: 'co' | 'wife' | 'joint' })[];
    }[] = [];
    for (const visit of visits) {
      const items = await this.repo.find({
        where: { congregationId, specialEventId: visit.id },
        relations: { assignee: true, cartLocation: true },
        order: { itemDate: 'ASC', startTime: 'ASC', sortOrder: 'ASC' },
      });
      const mine: (CoVisitItemView & {
        serviceWith?: 'co' | 'wife' | 'joint';
      })[] = [];
      for (const it of items) {
        if (it.kind === 'document_review') continue;
        // The wife's rows exist only for separate field service; legacy
        // copies of shared kinds (lunch, ...) would duplicate the item.
        if (it.forWife && it.kind !== 'field_service') continue;
        const isMineAssignee = it.assigneePublisherId === publisher.id;
        const isPioneerMeeting = it.kind === 'pioneers' && isPioneer;
        const isEldersMeeting = it.kind === 'elders' && isAppointed;
        if (!isMineAssignee && !isPioneerMeeting && !isEldersMeeting) continue;
        const view = toCoVisitItemView(it, false) as CoVisitItemView & {
          serviceWith?: 'co' | 'wife' | 'joint';
        };
        if (it.kind === 'field_service' && isMineAssignee) {
          view.serviceWith = it.forWife ? 'wife' : it.withWife ? 'joint' : 'co';
          // The type of service is personal: the wife's row carries her own
          // note (she may be in a different kind of ministry than the CO).
        }
        mine.push(view);
      }
      // The publisher hosting the couple sees the stay on their home screen.
      if (visit.coAccommodationPublisherId === publisher.id) {
        mine.unshift({
          id: `accommodation-${visit.id}`,
          kind: 'accommodation',
          forWife: false,
          withWife: false,
          itemDate: visit.date,
          startTime: null,
          placeKind: null,
          cartLocationId: null,
          cartLocationName: null,
          placeText: null,
          assigneePublisherId: publisher.id,
          assigneeName: null,
          assigneePhone: null,
          assigneeAddress: null,
          assigneeText: null,
          note: null,
          sortOrder: -1,
        });
      }
      if (mine.length > 0) {
        out.push({
          visit: {
            id: visit.id,
            title: visit.title,
            date: visit.date,
            endDate: visit.endDate ?? null,
          },
          items: mine,
        });
      }
    }
    return out;
  }

  private async canViewPrivate(
    congregationId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) {
      return true;
    }
    const account = await this.usersRepo.findOne({
      where: { id: user.id, congregationId },
    });
    return account?.canViewPrivateData === true;
  }

  async list(
    congregationId: string,
    specialEventId: string,
    user: AuthenticatedUser,
  ): Promise<CoVisitItemView[]> {
    const cvp = await this.canViewPrivate(congregationId, user);
    const items = await this.repo.find({
      where: { congregationId, specialEventId },
      relations: { assignee: true, cartLocation: true },
      order: { itemDate: 'ASC', sortOrder: 'ASC', startTime: 'ASC' },
    });
    return items.map((it) => toCoVisitItemView(it, cvp));
  }

  private async viewById(
    congregationId: string,
    id: string,
    canViewPrivate: boolean,
  ): Promise<CoVisitItemView> {
    const item = await this.repo.findOne({
      where: { id, congregationId },
      relations: { assignee: true, cartLocation: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    return toCoVisitItemView(item, canViewPrivate);
  }

  /**
   * A visit already over is a record, not a plan.
   *
   * The strip of visits at the top of the screen opened the earlier ones for
   * READING — which is what it was asked for — but it opened them for writing
   * just as much, and a circuit overseer's programme from last year is
   * something the congregation reports on, not something anyone should be
   * able to quietly rewrite.
   *
   * The same rule the duties of a past meeting already follow, in the same
   * words: the day is the CONGREGATION'S, and the refusal is written to the
   * journal — «who tried to change last year's visit» is exactly the question
   * that gets asked, and a rejection that leaves no trace answers nothing.
   *
   * Judged by the END of the visit: it runs several days, and it is over only
   * when the last of them has passed.
   */
  private async assertVisitEditable(
    congregationId: string,
    specialEventId: string,
  ): Promise<void> {
    const event = await this.eventsRepo.findOne({
      where: { id: specialEventId, congregationId },
    });
    if (!event) return; // the caller reports a missing visit in its own words

    const over = event.endDate ?? event.date;
    if (over >= (await this.clock.todayFor(congregationId))) return;

    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'co_visit_item',
      entityId: specialEventId,
      action: 'DENY',
      detail: { reason: 'past_visit_frozen', visitEnded: over },
    });
    throw new ConflictException(
      'This visit is already over; its programme is part of the record and can no longer be changed.',
    );
  }

  async create(
    congregationId: string,
    dto: CreateCoVisitItemDto,
    user: AuthenticatedUser,
  ): Promise<CoVisitItemView> {
    const event = await this.eventsRepo.findOne({
      where: { id: dto.specialEventId, congregationId },
    });
    if (!event) throw new NotFoundException('Visit not found');
    await this.assertVisitEditable(congregationId, dto.specialEventId);
    const entity = this.repo.create({
      congregationId,
      specialEventId: dto.specialEventId,
      kind: dto.kind,
      forWife: dto.forWife ?? false,
      withWife: dto.withWife ?? false,
      itemDate: dto.itemDate,
      startTime: dto.startTime ?? null,
      placeKind: dto.placeKind ?? null,
      cartLocationId: dto.cartLocationId ?? null,
      placeText: dto.placeText ?? null,
      assigneePublisherId: dto.assigneePublisherId ?? null,
      assigneeText: dto.assigneeText ?? null,
      note: dto.note ?? null,
      sortOrder: dto.sortOrder ?? 0,
    });
    const saved = await this.repo.save(entity);
    return this.viewById(
      congregationId,
      saved.id,
      await this.canViewPrivate(congregationId, user),
    );
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateCoVisitItemDto,
    user: AuthenticatedUser,
  ): Promise<CoVisitItemView> {
    const item = await this.repo.findOne({ where: { id, congregationId } });
    if (!item) throw new NotFoundException('Item not found');
    await this.assertVisitEditable(congregationId, item.specialEventId);
    if (dto.kind !== undefined) item.kind = dto.kind;
    if (dto.forWife !== undefined) item.forWife = dto.forWife;
    if (dto.withWife !== undefined) item.withWife = dto.withWife;
    if (dto.itemDate !== undefined) item.itemDate = dto.itemDate;
    if (dto.startTime !== undefined) item.startTime = dto.startTime ?? null;
    if (dto.placeKind !== undefined) item.placeKind = dto.placeKind ?? null;
    if (dto.cartLocationId !== undefined) {
      item.cartLocationId = dto.cartLocationId ?? null;
    }
    if (dto.placeText !== undefined) item.placeText = dto.placeText ?? null;
    if (dto.assigneePublisherId !== undefined) {
      item.assigneePublisherId = dto.assigneePublisherId ?? null;
    }
    if (dto.assigneeText !== undefined) {
      item.assigneeText = dto.assigneeText ?? null;
    }
    if (dto.note !== undefined) item.note = dto.note ?? null;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    await this.repo.save(item);
    return this.viewById(
      congregationId,
      id,
      await this.canViewPrivate(congregationId, user),
    );
  }

  /**
   * Remove an item — kept, not erased, and written down in full.
   *
   * The contents go into the journal because that is what an undo reads: the
   * row itself carries the state, but a person looking for what was lost looks
   * in the journal, and finds nothing there if we only flip a column.
   */
  async remove(
    congregationId: string,
    id: string,
    actorUserId?: string,
  ): Promise<void> {
    const item = await this.repo.findOne({ where: { id, congregationId } });
    if (!item) throw new NotFoundException('Item not found');
    await this.assertVisitEditable(congregationId, item.specialEventId);
    await this.repo.softDelete({ id, congregationId });
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'co_visit_item',
      entityId: id,
      action: 'DELETE',
      actorUserId,
      detail: {
        kind: item.kind,
        itemDate: item.itemDate,
        startTime: item.startTime,
        placeText: item.placeText,
        specialEventId: item.specialEventId,
      },
    });
  }

  /** Put a removed item back where it was. */
  async restore(congregationId: string, id: string): Promise<void> {
    const item = await this.repo.findOne({
      where: { id, congregationId },
      withDeleted: true,
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.deletedAt) return;
    // Putting something back is a change to the record too.
    await this.assertVisitEditable(congregationId, item.specialEventId);
    await this.repo.restore({ id, congregationId });
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'co_visit_item',
      entityId: id,
      action: 'RESTORE',
      detail: { kind: item.kind, itemDate: item.itemDate },
    });
  }
}
