import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AssignResponsibilityDto } from './dto/assign-responsibility.dto';

@Injectable()
export class ResponsibilitiesService {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly auditLog: AuditLogService,
  ) {}

  /** All responsibilities currently assigned in the congregation. */
  async findAll(tenantId: string): Promise<Responsibility[]> {
    return this.responsibilitiesRepo.find({
      where: { congregationId: tenantId },
      order: { type: 'ASC' },
    });
  }

  /**
   * Assigns a responsibility to a user. Because (congregationId, type) is
   * unique, assigning a type that is already held reassigns it to the new
   * user (replacing the previous holder).
   */
  async assign(
    tenantId: string,
    dto: AssignResponsibilityDto,
    assignedBy: string,
  ): Promise<Responsibility> {
    const user = await this.usersRepo.findOne({
      where: { id: dto.userId, congregationId: tenantId },
    });
    if (!user) {
      throw new NotFoundException('User not found in this congregation');
    }

    const existing = await this.responsibilitiesRepo.findOne({
      where: { congregationId: tenantId, type: dto.type, userId: dto.userId },
    });
    if (existing) {
      // Already assigned to this person — assignment is idempotent.
      return existing;
    }

    const created = this.responsibilitiesRepo.create({
      congregationId: tenantId,
      type: dto.type,
      userId: dto.userId,
      assignedBy,
    });
    const saved = await this.responsibilitiesRepo.save(created);
    // A responsibility is a privilege in the congregation, so who granted it
    // and to whom is exactly what a journal exists to answer.
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'responsibility',
      entityId: saved.id,
      subjectId: dto.userId,
      after: { type: saved.type, userId: saved.userId },
    });
    return saved;
  }

  /** Removes one person's responsibility assignment. */
  async revoke(
    tenantId: string,
    type: ResponsibilityType,
    userId: string,
  ): Promise<void> {
    const existing = await this.responsibilitiesRepo.findOne({
      where: { congregationId: tenantId, type, userId },
    });
    if (!existing) {
      throw new NotFoundException('Responsibility is not assigned');
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'responsibility',
      entityId: existing.id,
      action: 'DELETE',
      subjectId: userId,
      detail: { type, userId },
    });
    await this.responsibilitiesRepo.remove(existing);
  }
}
