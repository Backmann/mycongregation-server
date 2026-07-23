import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, Repository } from 'typeorm';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateExternalCongregationDto } from './dto/create-external-congregation.dto';
import { UpdateExternalCongregationDto } from './dto/update-external-congregation.dto';

/**
 * What the journal remembers about a guest congregation. The contact's phone
 * is a person's detail, so only the fact that it changed is recorded.
 */
const CONGREGATION_FIELDS = [
  'name',
  'city',
  'contactName',
  'note',
  'address',
  'meetingDow',
] as const;

function congregationSnapshot(
  row: ExternalCongregation,
): Record<string, unknown> {
  return {
    name: row.name,
    city: row.city,
    contactName: row.contactName,
    note: row.note,
    address: row.address,
    meetingDow: row.meetingDow,
  };
}

@Injectable()
export class ExternalCongregationsService {
  constructor(
    @InjectRepository(ExternalCongregation)
    private readonly repo: Repository<ExternalCongregation>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
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
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'external_congregation',
      entityId: saved.id,
      after: congregationSnapshot(saved),
    });
    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateExternalCongregationDto,
    user: AuthenticatedUser,
  ): Promise<ExternalCongregation> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    const before = congregationSnapshot(row);
    const phoneBefore = row.contactPhone;
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'external_congregation',
      entityId: saved.id,
      before,
      after: congregationSnapshot(saved),
      fields: [...CONGREGATION_FIELDS],
    });
    if (phoneBefore !== saved.contactPhone) {
      await this.auditLog.logRawUpdate({
        tenantId,
        entityType: 'external_congregation',
        entityId: saved.id,
        changedFields: ['contactPhone'],
        before: { contactPhone: '<скрыто>' },
        after: { contactPhone: '<скрыто>' },
      });
    }
    return saved;
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'external_congregation',
      entityId: row.id,
      action: 'DELETE',
      detail: { name: row.name, city: row.city },
    });
    await this.repo.softDelete(row.id);
  }
}
