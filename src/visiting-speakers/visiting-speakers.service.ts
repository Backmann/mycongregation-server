import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateVisitingSpeakerDto } from './dto/create-visiting-speaker.dto';
import { UpdateVisitingSpeakerDto } from './dto/update-visiting-speaker.dto';

@Injectable()
export class VisitingSpeakersService {
  constructor(
    @InjectRepository(VisitingSpeaker)
    private readonly repo: Repository<VisitingSpeaker>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.PUBLIC_TALK_COORDINATOR,
  ];

  /** Admins and the public talk coordinator may edit; everyone else may read. */
  private async assertCanWrite(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(VisitingSpeakersService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        'Only the public talk coordinator may edit visiting speakers',
      );
    }
  }

  findAll(tenantId: string): Promise<VisitingSpeaker[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      relations: { externalCongregation: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<VisitingSpeaker> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      relations: { externalCongregation: true },
    });
    if (!row) throw new NotFoundException('Visiting speaker not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateVisitingSpeakerDto,
    user: AuthenticatedUser,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const row = this.repo.create({ ...dto, congregationId: tenantId });
    return this.repo.save(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateVisitingSpeakerDto,
    user: AuthenticatedUser,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    Object.assign(row, dto);
    return this.repo.save(row);
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    await this.repo.softDelete(row.id);
  }
}
