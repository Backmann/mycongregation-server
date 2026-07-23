import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Repository } from 'typeorm';
import { CircuitOverseer } from '../entities/circuit-overseer.entity';
import {
  CreateCircuitOverseerDto,
  UpdateCircuitOverseerDto,
} from './dto/upsert-circuit-overseer.dto';

@Injectable()
export class CircuitOverseerService {
  constructor(
    @InjectRepository(CircuitOverseer)
    private readonly repo: Repository<CircuitOverseer>,
    private readonly auditLog: AuditLogService,
  ) {}

  /** All circuit overseers for the congregation, primary first. */
  async list(tenantId: string): Promise<CircuitOverseer[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: {
        isPrimary: 'DESC',
        role: 'ASC',
        lastName: 'ASC',
        firstName: 'ASC',
      },
    });
  }

  /** Add a circuit overseer. The first one (or an explicit flag) is primary. */
  async create(
    tenantId: string,
    dto: CreateCircuitOverseerDto,
  ): Promise<CircuitOverseer> {
    const count = await this.repo.count({
      where: { congregationId: tenantId },
    });
    const makePrimary = dto.isPrimary === true || count === 0;
    if (makePrimary) {
      await this.repo.update(
        { congregationId: tenantId },
        { isPrimary: false },
      );
    }
    const created = this.repo.create({
      congregationId: tenantId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      wifeName: dto.wifeName ?? null,
      role: dto.role ?? 'overseer',
      isPrimary: makePrimary,
    });
    const saved = await this.repo.save(created);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'circuit_overseer',
      entityId: saved.id,
      after: {
        firstName: saved.firstName,
        lastName: saved.lastName,
        wifeName: saved.wifeName,
        role: saved.role,
        isPrimary: saved.isPrimary,
      },
    });
    return saved;
  }

  /** Update a record; setting isPrimary demotes the previous primary. */
  async update(
    tenantId: string,
    id: string,
    dto: UpdateCircuitOverseerDto,
  ): Promise<CircuitOverseer> {
    const existing = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Circuit overseer not found');
    }
    const before = {
      firstName: existing.firstName,
      lastName: existing.lastName,
      wifeName: existing.wifeName,
      role: existing.role,
      isPrimary: existing.isPrimary,
    };
    if (dto.isPrimary === true && !existing.isPrimary) {
      await this.repo.update(
        { congregationId: tenantId },
        { isPrimary: false },
      );
      existing.isPrimary = true;
    }
    if (dto.firstName !== undefined) existing.firstName = dto.firstName;
    if (dto.lastName !== undefined) existing.lastName = dto.lastName;
    if (dto.wifeName !== undefined) existing.wifeName = dto.wifeName ?? null;
    if (dto.role !== undefined) existing.role = dto.role;
    const saved = await this.repo.save(existing);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'circuit_overseer',
      entityId: saved.id,
      before,
      after: {
        firstName: saved.firstName,
        lastName: saved.lastName,
        wifeName: saved.wifeName,
        role: saved.role,
        isPrimary: saved.isPrimary,
      },
      fields: ['firstName', 'lastName', 'wifeName', 'role', 'isPrimary'],
    });
    return saved;
  }

  /** Remove a record; if it was primary, promote the oldest remaining one. */
  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Circuit overseer not found');
    }
    const wasPrimary = existing.isPrimary;
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'circuit_overseer',
      entityId: existing.id,
      action: 'DELETE',
      detail: { firstName: existing.firstName, lastName: existing.lastName },
    });
    await this.repo.remove(existing);
    if (wasPrimary) {
      const next = await this.repo.findOne({
        where: { congregationId: tenantId },
        order: { createdAt: 'ASC' },
      });
      if (next) {
        next.isPrimary = true;
        await this.repo.save(next);
      }
    }
  }
}
