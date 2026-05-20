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
      where: { congregationId: tenantId, type: dto.type },
    });
    if (existing) {
      existing.userId = dto.userId;
      existing.assignedBy = assignedBy;
      existing.assignedAt = new Date();
      return this.responsibilitiesRepo.save(existing);
    }

    const created = this.responsibilitiesRepo.create({
      congregationId: tenantId,
      type: dto.type,
      userId: dto.userId,
      assignedBy,
    });
    return this.responsibilitiesRepo.save(created);
  }

  /** Removes a responsibility assignment from the congregation. */
  async revoke(tenantId: string, type: ResponsibilityType): Promise<void> {
    const existing = await this.responsibilitiesRepo.findOne({
      where: { congregationId: tenantId, type },
    });
    if (!existing) {
      throw new NotFoundException('Responsibility is not assigned');
    }
    await this.responsibilitiesRepo.remove(existing);
  }
}
