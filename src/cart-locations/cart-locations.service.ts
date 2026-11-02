import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { refusal } from '../common/errors/refusal';
import { CartSlot } from '../entities/cart-slot.entity';
import { CoVisitItem } from '../entities/co-visit-item.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Repository } from 'typeorm';
import { CartLocation } from '../entities/cart-location.entity';
import { CreateCartLocationDto } from './dto/create-cart-location.dto';
import { UpdateCartLocationDto } from './dto/update-cart-location.dto';

@Injectable()
export class CartLocationsService {
  constructor(
    @InjectRepository(CartLocation)
    private readonly repo: Repository<CartLocation>,
    private readonly auditLog: AuditLogService,
  ) {}

  list(
    congregationId: string,
    includeInactive = false,
  ): Promise<CartLocation[]> {
    const where = includeInactive
      ? { congregationId }
      : { congregationId, isActive: true };
    return this.repo.find({
      where,
      order: { isActive: 'DESC', name: 'ASC' },
    });
  }

  async getById(congregationId: string, id: string): Promise<CartLocation> {
    const row = await this.repo.findOne({ where: { id, congregationId } });
    if (!row) throw new NotFoundException('Cart location not found');
    return row;
  }

  async create(
    congregationId: string,
    dto: CreateCartLocationDto,
  ): Promise<CartLocation> {
    const row = this.repo.create({
      congregationId,
      name: dto.name,
      address: dto.address ?? null,
      kind: dto.kind ?? 'cart',
      equipmentAt:
        dto.equipmentAt !== undefined
          ? dto.equipmentAt.trim() || null
          : await this.usualEquipmentPlace(congregationId),
      isActive: dto.isActive ?? true,
    });
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'cart_location',
      entityId: saved.id,
      after: {
        name: saved.name,
        address: saved.address,
        kind: saved.kind,
        equipmentAt: saved.equipmentAt,
        isActive: saved.isActive,
      },
    });
    return saved;
  }

  /**
   * Where a new place fetches its equipment from when nobody said: where the
   * congregation's places usually do. One congregation keeps its carts in
   * one hall (Lionel: «по умолчанию это зал Царства в Ahlen»), and typing it
   * again for every new place is how it ends up spelt three ways.
   */
  private async usualEquipmentPlace(
    congregationId: string,
  ): Promise<string | null> {
    const rows = await this.repo.find({
      where: { congregationId },
      order: { createdAt: 'DESC' },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r.equipmentAt?.trim();
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: string | null = null;
    let n = 0;
    // The most common; among equals the newest, since rows come newest first.
    for (const [v, c] of counts) {
      if (c > n) {
        best = v;
        n = c;
      }
    }
    return best;
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateCartLocationDto,
  ): Promise<CartLocation> {
    const row = await this.getById(congregationId, id);
    const before = {
      name: row.name,
      address: row.address,
      kind: row.kind,
      equipmentAt: row.equipmentAt,
      isActive: row.isActive,
    };
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.address !== undefined) row.address = dto.address ?? null;
    if (dto.kind !== undefined) row.kind = dto.kind;
    if (dto.equipmentAt !== undefined)
      row.equipmentAt = dto.equipmentAt.trim() || null;
    if (dto.isActive !== undefined) row.isActive = dto.isActive;
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'cart_location',
      entityId: saved.id,
      before,
      after: {
        name: saved.name,
        address: saved.address,
        kind: saved.kind,
        equipmentAt: saved.equipmentAt,
        isActive: saved.isActive,
      },
      fields: ['name', 'address', 'kind', 'equipmentAt', 'isActive'],
    });
    return saved;
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const row = await this.getById(congregationId, id);
    // A place shifts were planned at is part of their history: removing it
    // failed in the database with a bare «Internal server error» — after the
    // journal had already written «deleted» (seen on the stand, 2 November
    // 2026). It is switched off instead; the journal speaks only after the
    // row is really gone.
    // A visit of the circuit overseer may plan an outing at it too; the
    // database would quietly blank that place, so it counts as use as well.
    const used =
      (await this.repo.manager.count(CartSlot, {
        where: { congregationId, locationId: id },
      })) +
      (await this.repo.manager.count(CoVisitItem, {
        where: { congregationId, cartLocationId: id },
        withDeleted: true,
      }));
    if (used > 0) {
      throw new ConflictException(
        refusal(
          'CART_LOCATION_IN_USE',
          'Shifts were planned at this place; switch it off instead of deleting it',
        ),
      );
    }
    // `remove` clears the entity's id: keep it for the journal.
    const removedId = row.id;
    await this.repo.remove(row);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'cart_location',
      entityId: removedId,
      action: 'DELETE',
      detail: { name: row.name, address: row.address },
    });
  }
}
