import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
  ) {}

  /**
   * The signed-in person's own slice of upcoming circuit-overseer visits,
   * readable by ANY authenticated member (unlike the full schedule):
   *   • items where they are the assignee (service partner, lunch host, …) —
   *     for a wife's separate-service row the "type of service" note is
   *     inherited from the overseer's paired row;
   *   • the pioneer meeting for regular pioneers;
   *   • the elders/MS meeting for elders and ministerial servants.
   * Private assignee data of other people is never included.
   */
  /**
   * Hosting rotation across ALL visits (past ones included): for every
   * publisher who has ever hosted a lunch / prepared a lunch box, the total,
   * the last past date and the next scheduled date. Powers the "who hasn't
   * hosted yet" ordering in the host picker.
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
      .andWhere('i.kind IN (:...kinds)', { kinds: ['lunch', 'lunch_box'] })
      .andWhere('i.assigneePublisherId IS NOT NULL')
      .getMany();
    const today = new Date().toISOString().slice(0, 10);
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
    return Array.from(map.values());
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
    const isPioneer = publisher.pioneerType === 'regular';
    const isAppointed =
      publisher.appointment === PublisherAppointment.ELDER ||
      publisher.appointment === PublisherAppointment.MINISTERIAL_SERVANT;

    const today = new Date().toISOString().slice(0, 10);
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

  async create(
    congregationId: string,
    dto: CreateCoVisitItemDto,
    user: AuthenticatedUser,
  ): Promise<CoVisitItemView> {
    const event = await this.eventsRepo.findOne({
      where: { id: dto.specialEventId, congregationId },
    });
    if (!event) throw new NotFoundException('Visit not found');
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

  async remove(congregationId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, congregationId });
    if (!res.affected) throw new NotFoundException('Item not found');
  }
}
