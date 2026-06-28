import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

export interface CoVisitItemView {
  id: string;
  kind: string;
  forWife: boolean;
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
  ) {}

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
