import { Injectable, NotFoundException } from '@nestjs/common';
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
        isActive: saved.isActive,
      },
    });
    return saved;
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
      isActive: row.isActive,
    };
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.address !== undefined) row.address = dto.address ?? null;
    if (dto.kind !== undefined) row.kind = dto.kind;
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
        isActive: saved.isActive,
      },
      fields: ['name', 'address', 'kind', 'isActive'],
    });
    return saved;
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const row = await this.getById(congregationId, id);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'cart_location',
      entityId: row.id,
      action: 'DELETE',
      detail: { name: row.name, address: row.address },
    });
    await this.repo.remove(row);
  }
}
