import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartLocation } from '../entities/cart-location.entity';
import { CreateCartLocationDto } from './dto/create-cart-location.dto';
import { UpdateCartLocationDto } from './dto/update-cart-location.dto';

@Injectable()
export class CartLocationsService {
  constructor(
    @InjectRepository(CartLocation)
    private readonly repo: Repository<CartLocation>,
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

  create(
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
    return this.repo.save(row);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateCartLocationDto,
  ): Promise<CartLocation> {
    const row = await this.getById(congregationId, id);
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.address !== undefined) row.address = dto.address ?? null;
    if (dto.kind !== undefined) row.kind = dto.kind;
    if (dto.isActive !== undefined) row.isActive = dto.isActive;
    return this.repo.save(row);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const row = await this.getById(congregationId, id);
    await this.repo.remove(row);
  }
}
