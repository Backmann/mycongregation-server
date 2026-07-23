import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Repository } from 'typeorm';
import { Hall } from '../entities/hall.entity';
import { CreateHallDto } from './dto/create-hall.dto';
import { UpdateHallDto } from './dto/update-hall.dto';

@Injectable()
export class HallsService {
  constructor(
    @InjectRepository(Hall)
    private readonly repo: Repository<Hall>,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Default hall first, then alphabetically. */
  async list(congregationId: string): Promise<Hall[]> {
    return this.repo.find({
      where: { congregationId },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async getById(congregationId: string, id: string): Promise<Hall> {
    const hall = await this.repo.findOne({ where: { id, congregationId } });
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    return hall;
  }

  /** The very first hall of a congregation becomes the default automatically. */
  async create(congregationId: string, dto: CreateHallDto): Promise<Hall> {
    const existing = await this.repo.count({ where: { congregationId } });
    const makeDefault = dto.isDefault === true || existing === 0;
    if (makeDefault && existing > 0) {
      await this.repo.update({ congregationId }, { isDefault: false });
    }
    const hall = this.repo.create({
      congregationId,
      name: dto.name.trim(),
      address: dto.address.trim(),
      isDefault: makeDefault,
    });
    const saved = await this.repo.save(hall);
    await this.auditLog.logCreate({
      tenantId: congregationId,
      entityType: 'hall',
      entityId: saved.id,
      after: {
        name: saved.name,
        address: saved.address,
        isDefault: saved.isDefault,
      },
    });
    return saved;
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateHallDto,
  ): Promise<Hall> {
    const hall = await this.getById(congregationId, id);
    const before = {
      name: hall.name,
      address: hall.address,
      isDefault: hall.isDefault,
    };
    if (dto.isDefault === true) {
      // Single default per congregation: clear the flag everywhere first.
      await this.repo.update({ congregationId }, { isDefault: false });
    }
    if (dto.name !== undefined) hall.name = dto.name.trim();
    if (dto.address !== undefined) hall.address = dto.address.trim();
    if (dto.isDefault !== undefined) hall.isDefault = dto.isDefault;
    const saved = await this.repo.save(hall);
    await this.auditLog.logUpdate({
      tenantId: congregationId,
      entityType: 'hall',
      entityId: saved.id,
      before,
      after: {
        name: saved.name,
        address: saved.address,
        isDefault: saved.isDefault,
      },
      fields: ['name', 'address', 'isDefault'],
    });
    return saved;
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const hall = await this.getById(congregationId, id);
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'hall',
      entityId: hall.id,
      action: 'DELETE',
      detail: { name: hall.name, address: hall.address },
    });
    await this.repo.remove(hall);
  }
}
