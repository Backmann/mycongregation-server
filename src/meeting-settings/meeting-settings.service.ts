import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { UpsertMeetingSettingsDto } from './dto/upsert-meeting-settings.dto';
import { UpdateCongregationDto } from './dto/update-congregation.dto';

@Injectable()
export class MeetingSettingsService {
  constructor(
    @InjectRepository(MeetingSettings)
    private readonly repo: Repository<MeetingSettings>,
    @InjectRepository(Congregation)
    private readonly congRepo: Repository<Congregation>,
    private readonly auditLog: AuditLogService,
  ) {}

  private async getCongregation(tenantId: string): Promise<Congregation> {
    const congregation = await this.congRepo.findOne({
      where: { id: tenantId },
    });
    if (!congregation) {
      throw new NotFoundException('Congregation not found');
    }
    return congregation;
  }

  async updateCongregation(
    tenantId: string,
    dto: UpdateCongregationDto,
  ): Promise<Congregation> {
    const congregation = await this.getCongregation(tenantId);
    const before = {
      name: congregation.name,
      timezone: congregation.timezone,
      assignmentAutomationEnabled: congregation.assignmentAutomationEnabled,
    };
    if (dto.name !== undefined) congregation.name = dto.name;
    if (dto.timezone !== undefined) congregation.timezone = dto.timezone;
    if (dto.assignmentAutomationEnabled !== undefined)
      congregation.assignmentAutomationEnabled =
        dto.assignmentAutomationEnabled;
    const saved = await this.congRepo.save(congregation);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'congregation',
      entityId: saved.id,
      before,
      after: {
        name: saved.name,
        timezone: saved.timezone,
        assignmentAutomationEnabled: saved.assignmentAutomationEnabled,
      },
      fields: ['name', 'timezone', 'assignmentAutomationEnabled'],
    });
    return saved;
  }

  listVersions(tenantId: string): Promise<MeetingSettings[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: { effectiveFrom: 'DESC' },
    });
  }

  /** The version in force on `onDate` (default today): latest effectiveFrom <= date. */
  async getEffective(
    tenantId: string,
    onDate?: string,
  ): Promise<MeetingSettings | null> {
    const date = onDate ?? new Date().toISOString().slice(0, 10);
    const rows = await this.repo.find({
      where: {
        congregationId: tenantId,
        effectiveFrom: LessThanOrEqual(date),
      },
      order: { effectiveFrom: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /** Create a version, or update the existing one with the same effectiveFrom. */
  async upsert(
    tenantId: string,
    dto: UpsertMeetingSettingsDto,
  ): Promise<MeetingSettings> {
    let row = await this.repo.findOne({
      where: { congregationId: tenantId, effectiveFrom: dto.effectiveFrom },
    });
    if (!row) {
      row = this.repo.create({
        congregationId: tenantId,
        effectiveFrom: dto.effectiveFrom,
      });
    }
    row.midweekDow = dto.midweekDow;
    row.midweekTime = dto.midweekTime;
    row.weekendDow = dto.weekendDow;
    row.weekendTime = dto.weekendTime;
    row.address = dto.address;
    row.microphoneSlots = dto.microphoneSlots ?? 2;
    return this.repo.save(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!row) {
      throw new NotFoundException('Meeting settings version not found');
    }
    await this.repo.remove(row);
  }

  /** Everything the settings screen needs in one call. */
  async overview(tenantId: string): Promise<{
    congregation: {
      id: string;
      name: string;
      timezone: string | null;
      assignmentAutomationEnabled: boolean;
    };
    versions: MeetingSettings[];
    effective: MeetingSettings | null;
  }> {
    const [congregation, versions, effective] = await Promise.all([
      this.getCongregation(tenantId),
      this.listVersions(tenantId),
      this.getEffective(tenantId),
    ]);
    return {
      congregation: {
        id: congregation.id,
        name: congregation.name,
        timezone: congregation.timezone,
        assignmentAutomationEnabled: congregation.assignmentAutomationEnabled,
      },
      versions,
      effective,
    };
  }
}
