import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, Repository } from 'typeorm';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateVisitingSpeakerDto } from './dto/create-visiting-speaker.dto';
import { UpdateVisitingSpeakerDto } from './dto/update-visiting-speaker.dto';

/**
 * What the journal remembers about a visiting speaker. The phone is a person's
 * contact detail, so it is recorded as the FACT that it changed and never as
 * the number itself — the same rule the publisher card follows.
 */
const SPEAKER_FIELDS = [
  'firstName',
  'lastName',
  'externalCongregationId',
  'note',
  'talkNumbers',
] as const;

function speakerSnapshot(row: VisitingSpeaker): Record<string, unknown> {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    externalCongregationId: row.externalCongregationId,
    note: row.note,
    talkNumbers: row.talkNumbers,
  };
}

@Injectable()
export class VisitingSpeakersService {
  constructor(
    @InjectRepository(VisitingSpeaker)
    private readonly repo: Repository<VisitingSpeaker>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
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
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: saved.id,
      after: speakerSnapshot(saved),
    });
    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateVisitingSpeakerDto,
    user: AuthenticatedUser,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    const before = speakerSnapshot(row);
    const phoneBefore = row.phone;
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: saved.id,
      before,
      after: speakerSnapshot(saved),
      fields: [...SPEAKER_FIELDS],
    });
    if (phoneBefore !== saved.phone) {
      // The number itself never enters the journal — only that it moved.
      await this.auditLog.logRawUpdate({
        tenantId,
        entityType: 'visiting_speaker',
        entityId: saved.id,
        changedFields: ['phone'],
        before: { phone: '<скрыто>' },
        after: { phone: '<скрыто>' },
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
      entityType: 'visiting_speaker',
      entityId: row.id,
      action: 'DELETE',
      detail: { firstName: row.firstName, lastName: row.lastName },
    });
    await this.repo.softDelete(row.id);
  }
}
