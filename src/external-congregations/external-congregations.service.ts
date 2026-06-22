import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateExternalCongregationDto } from './dto/create-external-congregation.dto';
import { UpdateExternalCongregationDto } from './dto/update-external-congregation.dto';

@Injectable()
export class ExternalCongregationsService {
  constructor(
    @InjectRepository(ExternalCongregation)
    private readonly repo: Repository<ExternalCongregation>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  /** Responsibilities (besides admin) that may edit the speaker directories. */
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
        type: In(ExternalCongregationsService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        'Only the public talk coordinator may edit congregations',
      );
    }
  }

  findAll(tenantId: string): Promise<ExternalCongregation[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: { name: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<ExternalCongregation> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!row) throw new NotFoundException('Congregation not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateExternalCongregationDto,
    user: AuthenticatedUser,
  ): Promise<ExternalCongregation> {
    await this.assertCanWrite(user);
    const row = this.repo.create({ ...dto, congregationId: tenantId });
    return this.repo.save(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateExternalCongregationDto,
    user: AuthenticatedUser,
  ): Promise<ExternalCongregation> {
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
