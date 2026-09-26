import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Repository } from 'typeorm';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { MeetingAttendance } from '../entities/meeting-attendance.entity';
import { pastImpact, type PastImpact } from './past-impact';
import { mondayOf } from '../common/week';
import { addDaysISO } from '../common/week-rules';
import { UpsertMeetingSettingsDto } from './dto/upsert-meeting-settings.dto';
import { UpdateCongregationDto } from './dto/update-congregation.dto';
import { CongregationClock } from '../common/congregation-clock.service';

@Injectable()
export class MeetingSettingsService {
  constructor(
    @InjectRepository(MeetingSettings)
    private readonly repo: Repository<MeetingSettings>,
    @InjectRepository(Congregation)
    private readonly congRepo: Repository<Congregation>,
    private readonly auditLog: AuditLogService,
    private readonly clock: CongregationClock,
    @InjectRepository(MeetingAttendance)
    private readonly attendanceRepo: Repository<MeetingAttendance>,
  ) {}

  /**
   * What saving this version would change in weeks already begun — asked
   * before saving, so the screen can say it in plain words (26 September).
   */
  async impact(
    tenantId: string,
    dto: UpsertMeetingSettingsDto,
  ): Promise<PastImpact> {
    const today = await this.clock.todayFor(tenantId);
    const existing = await this.repo.find({
      where: { congregationId: tenantId },
      order: { effectiveFrom: 'ASC' },
    });
    const candidate = {
      effectiveFrom: dto.effectiveFrom.slice(0, 10),
      midweekDow: dto.midweekDow,
      midweekTime: dto.midweekTime,
      weekendDow: dto.weekendDow,
      weekendTime: dto.weekendTime,
      address: dto.address,
      // Saving without the field keeps what the version had (upsert below);
      // a new version without it gets 2.
      microphoneSlots:
        dto.microphoneSlots ??
        existing.find((v) => v.effectiveFrom === dto.effectiveFrom.slice(0, 10))
          ?.microphoneSlots ??
        2,
    };
    // Only weeks already begun can hold recorded attendance.
    const earliest = [
      candidate.effectiveFrom,
      ...existing.map((v) => v.effectiveFrom),
    ].sort()[0];
    const attendance =
      earliest <= today
        ? await this.attendanceRepo.find({
            where: {
              congregationId: tenantId,
              date: Between(mondayOf(earliest), addDaysISO(mondayOf(today), 6)),
            },
            select: { date: true, eventType: true },
          })
        : [];
    return pastImpact({
      existing: existing.map((v) => ({
        effectiveFrom: v.effectiveFrom,
        midweekDow: v.midweekDow,
        midweekTime: v.midweekTime,
        weekendDow: v.weekendDow,
        weekendTime: v.weekendTime,
        address: v.address,
        microphoneSlots: v.microphoneSlots,
      })),
      candidate,
      today,
      attendance: attendance.map((a) => ({
        date: String(a.date).slice(0, 10),
        eventType: a.eventType,
      })),
    });
  }

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
    // Which version is in force is asked by nearly every screen, so the day
    // has to be the congregation's own — between midnight and 02:00 in summer
    // the server's UTC date is still yesterday, and a version that starts
    // today would not yet count.
    const date = onDate ?? (await this.clock.todayFor(tenantId));
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
    // Attendance already recorded on a weekday the change takes the meeting
    // away from cannot be put right afterwards; that one consequence needs a
    // yes from the person, not only a warning an older app never shows.
    if (!dto.confirmPast) {
      const impact = await this.impact(tenantId, dto);
      if (impact.attendanceOnMovedDays > 0) {
        throw new ConflictException(
          `This moves meetings of weeks already begun to another weekday, and attendance for ${impact.attendanceOnMovedDays} of them is already recorded on the old day. Confirm to save.`,
        );
      }
    }
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
    // Only a version that has not started yet may go (agreed 25 September).
    // Past weeks are read through the version that was in force then — the
    // attendance sheet (S-3), duties and the week rules all look it up — so
    // deleting one that has started would quietly move those weeks onto
    // another schedule, and deleting the only one would leave the
    // congregation with no meeting time at all. A mistake in the current
    // version is corrected by saving it again with the same date.
    const today = await this.clock.todayFor(tenantId);
    if (row.effectiveFrom <= today) {
      throw new ConflictException(
        'This schedule version is already in force: past weeks are counted by it, so it cannot be deleted. Correct it by saving the schedule with the same start date.',
      );
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
