import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
    return this.responsibilitiesRepo.save(created);
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
    await this.responsibilitiesRepo.remove(existing);
  }
}
