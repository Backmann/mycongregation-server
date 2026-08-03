import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { PioneerSchool } from '../entities/pioneer-school.entity';
import { PioneerSchoolDay } from '../entities/pioneer-school-day.entity';
import { PioneerSchoolDuty } from '../entities/pioneer-school-duty.entity';
import { PioneerSchoolHelper } from '../entities/pioneer-school-helper.entity';
import { Absence } from '../entities/absence.entity';
import { Duty } from '../entities/duty.entity';
import { DutyType } from '../common/enums/duty-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { mondayOf } from '../common/week';
import {
  AssignPioneerSchoolDutyDto,
  CreatePioneerSchoolDto,
  CreatePioneerSchoolDutyDto,
  CreatePioneerSchoolHelperDto,
  UpdatePioneerSchoolDayDto,
  UpdatePioneerSchoolDto,
  UpdatePioneerSchoolHelperDto,
} from './dto/pioneer-school.dto';

/** The roles a school day carries, in the order they are read. */
const AV_SLOT = { dutyType: DutyType.AV, slotIndex: 0 };
const VENTILATION_SLOT = { dutyType: DutyType.VENTILATION, slotIndex: 0 };

/** Every day of a range, inclusive, as calendar dates. */
function datesBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  const cursor = new Date(`${startDate}T00:00:00Z`);
  // A school is days, not months. The guard is a plain sanity limit so a
  // mistyped year cannot ask the database for thirty thousand rows.
  while (cursor.getTime() <= end.getTime() && out.length < 90) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

@Injectable()
export class PioneerSchoolService {
  constructor(
    @InjectRepository(PioneerSchool)
    private readonly schoolsRepo: Repository<PioneerSchool>,
    @InjectRepository(PioneerSchoolDay)
    private readonly daysRepo: Repository<PioneerSchoolDay>,
    @InjectRepository(PioneerSchoolDuty)
    private readonly dutiesRepo: Repository<PioneerSchoolDuty>,
    @InjectRepository(PioneerSchoolHelper)
    private readonly helpersRepo: Repository<PioneerSchoolHelper>,
    @InjectRepository(Absence)
    private readonly absencesRepo: Repository<Absence>,
    @InjectRepository(Duty)
    private readonly meetingDutiesRepo: Repository<Duty>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Only an administrator keeps the schedule — Lionel's decision, and the
   * narrow door is deliberate: this is one person's job at a time.
   *
   * Reading is open to elders as well. They are the ones organising the week,
   * and the sheet goes out to twenty brothers anyway; refusing them a look at
   * what they are about to be sent would be theatre.
   */
  private assertCanEdit(user: AuthenticatedUser): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator may edit the school');
    }
  }

  private assertCanView(user: AuthenticatedUser): void {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) return;
    throw new ForbiddenException('The school schedule is for elders');
  }

  // ---------------------------------------------------------------- schools

  async findAll(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<PioneerSchool[]> {
    this.assertCanView(user);
    return this.schoolsRepo.find({
      where: { congregationId: tenantId },
      order: { startDate: 'DESC' },
    });
  }

  async create(
    tenantId: string,
    dto: CreatePioneerSchoolDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchool> {
    this.assertCanEdit(user);
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate is before startDate');
    }
    const school = await this.schoolsRepo.save(
      this.schoolsRepo.create({
        ...dto,
        congregationId: tenantId,
        microphoneSlots: dto.microphoneSlots ?? 2,
      }),
    );
    await this.reconcile(school);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'pioneer_school',
      entityId: school.id,
      after: {
        title: school.title,
        startDate: school.startDate,
        endDate: school.endDate,
      },
    });
    return school;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePioneerSchoolDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchool> {
    this.assertCanEdit(user);
    const school = await this.getSchool(tenantId, id);
    const before = {
      title: school.title,
      startDate: school.startDate,
      endDate: school.endDate,
      hallName: school.hallName,
      microphoneSlots: school.microphoneSlots,
    };
    Object.assign(school, dto);
    if (school.endDate < school.startDate) {
      throw new BadRequestException('endDate is before startDate');
    }
    const saved = await this.schoolsRepo.save(school);
    await this.reconcile(saved);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'pioneer_school',
      entityId: saved.id,
      before,
      after: {
        title: saved.title,
        startDate: saved.startDate,
        endDate: saved.endDate,
        hallName: saved.hallName,
        microphoneSlots: saved.microphoneSlots,
      },
      fields: ['title', 'startDate', 'endDate', 'hallName', 'microphoneSlots'],
    });
    return saved;
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.assertCanEdit(user);
    const school = await this.getSchool(tenantId, id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'pioneer_school',
      entityId: id,
      action: 'DELETE',
      detail: { title: school.title },
    });
    await this.schoolsRepo.softDelete(id);
  }

  /**
   * The days and the role rows the school's own settings imply.
   *
   * Adds what is missing and removes only what the settings no longer allow —
   * a day outside the dates, a microphone above the count. Assignments on
   * everything that survives are left exactly as they were: moving the end of
   * a school by a day must not quietly empty the other five.
   */
  private async reconcile(school: PioneerSchool): Promise<void> {
    const wanted = datesBetween(school.startDate, school.endDate);
    const existing = await this.daysRepo.find({
      where: { schoolId: school.id },
    });
    const byDate = new Map(existing.map((d) => [d.date.slice(0, 10), d]));

    const gone = existing.filter((d) => !wanted.includes(d.date.slice(0, 10)));
    if (gone.length > 0) {
      await this.daysRepo.delete({ id: In(gone.map((d) => d.id)) });
    }

    for (const date of wanted) {
      let day = byDate.get(date);
      if (!day) {
        day = await this.daysRepo.save(
          this.daysRepo.create({
            congregationId: school.congregationId,
            schoolId: school.id,
            date,
            startTime: null,
            endTime: null,
          }),
        );
      }
      await this.reconcileDuties(school, day);
    }
  }

  private async reconcileDuties(
    school: PioneerSchool,
    day: PioneerSchoolDay,
  ): Promise<void> {
    const rows = await this.dutiesRepo.find({ where: { dayId: day.id } });
    const has = (dutyType: DutyType, slotIndex: number) =>
      rows.some((r) => r.dutyType === dutyType && r.slotIndex === slotIndex);

    const wanted: { dutyType: DutyType; slotIndex: number }[] = [
      AV_SLOT,
      ...Array.from({ length: school.microphoneSlots }, (_, i) => ({
        dutyType: DutyType.MICROPHONE,
        slotIndex: i,
      })),
      VENTILATION_SLOT,
    ];

    for (const slot of wanted) {
      if (has(slot.dutyType, slot.slotIndex)) continue;
      await this.dutiesRepo.save(
        this.dutiesRepo.create({
          congregationId: school.congregationId,
          dayId: day.id,
          dutyType: slot.dutyType,
          slotIndex: slot.slotIndex,
          customLabel: null,
          helperId: null,
        }),
      );
    }

    // Microphones above the current count go; custom rows are never touched by
    // reconciliation, because nothing in the settings implies them.
    const surplus = rows.filter(
      (r) =>
        r.dutyType === DutyType.MICROPHONE &&
        r.slotIndex >= school.microphoneSlots,
    );
    if (surplus.length > 0) {
      await this.dutiesRepo.delete({ id: In(surplus.map((r) => r.id)) });
    }
  }

  private async getSchool(
    tenantId: string,
    id: string,
  ): Promise<PioneerSchool> {
    const found = await this.schoolsRepo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) throw new NotFoundException('School not found');
    return found;
  }

  // ------------------------------------------------------------- the sheet

  /**
   * Everything one screen and one printed sheet need, in one answer: the
   * school, its days in order, the roles of each day with the names already
   * resolved, and the warnings.
   */
  async getFull(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<{
    school: PioneerSchool;
    days: {
      id: string;
      date: string;
      startTime: string | null;
      endTime: string | null;
      duties: {
        id: string;
        dutyType: DutyType;
        slotIndex: number;
        customLabel: string | null;
        helperId: string | null;
        helperName: string | null;
        helperCongregation: string | null;
        warnings: string[];
      }[];
    }[];
  }> {
    this.assertCanView(user);
    const school = await this.getSchool(tenantId, id);
    const days = await this.daysRepo.find({
      where: { schoolId: school.id },
      order: { date: 'ASC' },
    });
    const duties =
      days.length === 0
        ? []
        : await this.dutiesRepo.find({
            where: { dayId: In(days.map((d) => d.id)) },
          });
    const helpers = await this.helpersRepo.find({
      where: { congregationId: tenantId },
    });
    const helperById = new Map(helpers.map((h) => [h.id, h]));
    const warnings = await this.warningsFor(tenantId, days, duties, helpers);

    return {
      school,
      days: days.map((d) => ({
        id: d.id,
        date: d.date.slice(0, 10),
        startTime: d.startTime,
        endTime: d.endTime,
        duties: duties
          .filter((r) => r.dayId === d.id)
          .sort(
            (a, b) =>
              this.order(a.dutyType) - this.order(b.dutyType) ||
              a.slotIndex - b.slotIndex,
          )
          .map((r) => {
            const helper = r.helperId ? helperById.get(r.helperId) : null;
            return {
              id: r.id,
              dutyType: r.dutyType,
              slotIndex: r.slotIndex,
              customLabel: r.customLabel,
              helperId: r.helperId,
              helperName: helper
                ? `${helper.firstName} ${helper.lastName}`.trim()
                : null,
              helperCongregation: helper?.congregationName ?? null,
              warnings: warnings.get(r.id) ?? [],
            };
          }),
      })),
    };
  }

  private order(dutyType: DutyType): number {
    if (dutyType === DutyType.AV) return 0;
    if (dutyType === DutyType.MICROPHONE) return 1;
    if (dutyType === DutyType.VENTILATION) return 2;
    return 3;
  }

  /**
   * What the person filling the sheet cannot see for himself.
   *
   * Never a refusal — the man arranging this knows things the app does not,
   * and a brother may well have arranged to come back early from his trip. But
   * a schedule that quietly puts an absent brother on a microphone is found
   * out on the day, in front of the class.
   *
   *   away            — an absence covering that date
   *   busyAtMeeting   — already on a duty at our own meeting that week
   *   twoMicrophones  — both microphones in one day, which is not possible
   */
  private async warningsFor(
    tenantId: string,
    days: PioneerSchoolDay[],
    duties: PioneerSchoolDuty[],
    helpers: PioneerSchoolHelper[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const add = (id: string, w: string) =>
      out.set(id, [...(out.get(id) ?? []), w]);
    if (days.length === 0) return out;

    const ours = helpers.filter((h) => h.publisherId);
    const publisherIds = ours.map((h) => h.publisherId as string);
    const helperByPublisher = new Map(
      ours.map((h) => [h.publisherId as string, h.id]),
    );
    const dateById = new Map(days.map((d) => [d.id, d.date.slice(0, 10)]));

    // Both microphones on one day — the only thing here that is impossible
    // rather than merely awkward.
    const micByDay = new Map<string, Map<string, string[]>>();
    for (const r of duties) {
      if (r.dutyType !== DutyType.MICROPHONE || !r.helperId) continue;
      const perDay = micByDay.get(r.dayId) ?? new Map<string, string[]>();
      perDay.set(r.helperId, [...(perDay.get(r.helperId) ?? []), r.id]);
      micByDay.set(r.dayId, perDay);
    }
    for (const perDay of micByDay.values()) {
      for (const ids of perDay.values()) {
        if (ids.length > 1) ids.forEach((id) => add(id, 'twoMicrophones'));
      }
    }

    if (publisherIds.length === 0) return out;

    const absences = await this.absencesRepo.find({
      where: { congregationId: tenantId, publisherId: In(publisherIds) },
    });
    const meetingDuties = await this.meetingDutiesRepo.find({
      where: {
        congregationId: tenantId,
        publisherId: In(publisherIds),
        weekStartDate: In([
          ...new Set(days.map((d) => mondayOf(d.date.slice(0, 10)))),
        ]),
      },
    });

    for (const r of duties) {
      if (!r.helperId) continue;
      const date = dateById.get(r.dayId);
      if (!date) continue;
      const publisherId = ours.find((h) => h.id === r.helperId)?.publisherId;
      if (!publisherId) continue;

      const away = absences.some(
        (a) =>
          a.publisherId === publisherId &&
          a.startDate.slice(0, 10) <= date &&
          (a.endDate ?? a.startDate).slice(0, 10) >= date,
      );
      if (away) add(r.id, 'away');

      const week = mondayOf(date);
      const busy = meetingDuties.some(
        (d) =>
          d.publisherId === publisherId &&
          d.weekStartDate.slice(0, 10) === week,
      );
      if (busy) add(r.id, 'busyAtMeeting');
    }
    void helperByPublisher;
    return out;
  }

  // ----------------------------------------------------------------- days

  async updateDay(
    tenantId: string,
    schoolId: string,
    dayId: string,
    dto: UpdatePioneerSchoolDayDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolDay> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const day = await this.daysRepo.findOne({ where: { id: dayId, schoolId } });
    if (!day) throw new NotFoundException('Day not found');
    Object.assign(day, dto);
    return this.daysRepo.save(day);
  }

  // ---------------------------------------------------------------- duties

  async assignDuty(
    tenantId: string,
    schoolId: string,
    dutyId: string,
    dto: AssignPioneerSchoolDutyDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolDuty> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const duty = await this.dutiesRepo.findOne({
      where: { id: dutyId, congregationId: tenantId },
    });
    if (!duty) throw new NotFoundException('Duty not found');
    if (dto.helperId) {
      const helper = await this.helpersRepo.findOne({
        where: { id: dto.helperId, congregationId: tenantId },
      });
      if (!helper) throw new NotFoundException('Helper not found');
    }
    duty.helperId = dto.helperId ?? null;
    return this.dutiesRepo.save(duty);
  }

  async addCustomDuty(
    tenantId: string,
    schoolId: string,
    dto: CreatePioneerSchoolDutyDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolDuty> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const day = await this.daysRepo.findOne({
      where: { id: dto.dayId, schoolId },
    });
    if (!day) throw new NotFoundException('Day not found');
    const existing = await this.dutiesRepo.find({
      where: { dayId: day.id, dutyType: DutyType.CUSTOM },
    });
    const slotIndex =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((r) => r.slotIndex)) + 1;
    return this.dutiesRepo.save(
      this.dutiesRepo.create({
        congregationId: tenantId,
        dayId: day.id,
        dutyType: DutyType.CUSTOM,
        slotIndex,
        customLabel: dto.customLabel,
        helperId: dto.helperId ?? null,
      }),
    );
  }

  async removeCustomDuty(
    tenantId: string,
    schoolId: string,
    dutyId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const duty = await this.dutiesRepo.findOne({
      where: { id: dutyId, congregationId: tenantId },
    });
    if (!duty) throw new NotFoundException('Duty not found');
    if (duty.dutyType !== DutyType.CUSTOM) {
      // The standing roles come from the school's settings; removing one here
      // would be undone by the next reconciliation, which is worse than a
      // refusal because it looks like it worked.
      throw new BadRequestException('Only a custom role can be removed');
    }
    await this.dutiesRepo.delete(duty.id);
  }

  // --------------------------------------------------------------- helpers

  async listHelpers(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolHelper[]> {
    this.assertCanView(user);
    return this.helpersRepo.find({
      where: { congregationId: tenantId },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  }

  async createHelper(
    tenantId: string,
    dto: CreatePioneerSchoolHelperDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolHelper> {
    this.assertCanEdit(user);
    return this.helpersRepo.save(
      this.helpersRepo.create({ ...dto, congregationId: tenantId }),
    );
  }

  async updateHelper(
    tenantId: string,
    id: string,
    dto: UpdatePioneerSchoolHelperDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolHelper> {
    this.assertCanEdit(user);
    const helper = await this.helpersRepo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!helper) throw new NotFoundException('Helper not found');
    Object.assign(helper, dto);
    return this.helpersRepo.save(helper);
  }

  async removeHelper(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.assertCanEdit(user);
    const helper = await this.helpersRepo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!helper) throw new NotFoundException('Helper not found');
    // Soft: his name stays on the schools he already served, and the duty rows
    // keep pointing at a row that still exists.
    await this.helpersRepo.softDelete(id);
  }

  /** How many days each helper already holds — the load, for the picker. */
  async helperLoad(
    tenantId: string,
    schoolId: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, number>> {
    this.assertCanView(user);
    const days = await this.daysRepo.find({ where: { schoolId } });
    if (days.length === 0) return {};
    const duties = await this.dutiesRepo.find({
      where: {
        congregationId: tenantId,
        dayId: In(days.map((d) => d.id)),
        helperId: Not(IsNull()),
      },
    });
    const perHelper = new Map<string, Set<string>>();
    for (const r of duties) {
      const set = perHelper.get(r.helperId as string) ?? new Set<string>();
      set.add(r.dayId);
      perHelper.set(r.helperId as string, set);
    }
    return Object.fromEntries(
      [...perHelper.entries()].map(([id, set]) => [id, set.size]),
    );
  }
}
