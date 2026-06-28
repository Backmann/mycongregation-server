import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { CreateCoVisitItemDto } from './dto/create-co-visit-item.dto';
import { UpdateCoVisitItemDto } from './dto/update-co-visit-item.dto';

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
  assigneeText: string | null;
  note: string | null;
  sortOrder: number;
}

/**
 * Pure mapper: entity (with assignee + cartLocation relations loaded) -> the
 * view sent to the client. Names are not private data; phones/addresses are
 * deliberately NOT exposed here (added later behind canViewPrivateData).
 */
export function toCoVisitItemView(item: CoVisitItem): CoVisitItemView {
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
  ) {}

  async list(
    congregationId: string,
    specialEventId: string,
  ): Promise<CoVisitItemView[]> {
    const items = await this.repo.find({
      where: { congregationId, specialEventId },
      relations: { assignee: true, cartLocation: true },
      order: { itemDate: 'ASC', sortOrder: 'ASC', startTime: 'ASC' },
    });
    return items.map(toCoVisitItemView);
  }

  private async viewById(
    congregationId: string,
    id: string,
  ): Promise<CoVisitItemView> {
    const item = await this.repo.findOne({
      where: { id, congregationId },
      relations: { assignee: true, cartLocation: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    return toCoVisitItemView(item);
  }

  async create(
    congregationId: string,
    dto: CreateCoVisitItemDto,
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
    return this.viewById(congregationId, saved.id);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateCoVisitItemDto,
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
    return this.viewById(congregationId, id);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, congregationId });
    if (!res.affected) throw new NotFoundException('Item not found');
  }
}
