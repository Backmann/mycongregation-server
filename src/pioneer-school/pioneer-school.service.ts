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
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';
import { EventType } from '../common/enums/event-type.enum';
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

/** Said in the congregation's own words, not in code. */
const PIONEER_SCHOOL_ABSENCE_NOTE = 'Школа пионерского служения';

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
    private readonly meetingAttendance: MeetingAttendanceService,
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
      // Chronological: a schedule is read forwards, and the school people are
      // asking about is the next one, not the last one.
      order: { startDate: 'ASC' },
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
        /** He is no longer on the list of brothers, but he is still here. */
        helperRemoved: boolean;
        warnings: string[];
      }[];
    }[];
  }> {
    this.assertCanView(user);
    const school = await this.getSchool(tenantId, id);
    try {
      await this.syncAbsencesForSchool(tenantId, id);
    } catch {
      // A schedule that opens is worth more than a reconciliation that ran.
    }
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
    // withDeleted: a brother taken off the list still stands on the days he
    // was given. Dropping him from this map turned his rows into «не
    // назначен» — on screen and on the printed sheet — as if nobody had ever
    // been there, which is the one thing a schedule must not do quietly.
    const helpers = await this.helpersRepo.find({
      where: { congregationId: tenantId },
      withDeleted: true,
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
              helperRemoved: !!helper?.deletedAt,
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

    // The app's own bookkeeping must not be read back as news.
    //
    // Serving here on our meeting evening WRITES an absence — and that absence
    // was then found again by this very check, so the schedule told the reader
    // «в этот день в отъезде» about the man standing in front of him, on the
    // row that had put him there. The app was arguing with itself.
    //
    // Absences from ANOTHER school stay: a brother booked in Soest that
    // evening genuinely cannot be in Ahlen, and that is worth saying.
    const ownDutyIds = new Set(duties.map((d) => d.id));
    const absences = (
      await this.absencesRepo.find({
        where: { congregationId: tenantId, publisherId: In(publisherIds) },
      })
    ).filter(
      (a) => !a.pioneerSchoolDutyId || !ownDutyIds.has(a.pioneerSchoolDutyId),
    );
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

  /**
   * A duty, checked against the school it is claimed to belong to.
   *
   * Scoping by congregation alone let a duty of one school be edited through
   * another school's address. Same congregation, so nothing leaked — but the
   * two schools are separate documents, and an id in the wrong one is a bug
   * waiting for the day two schools overlap.
   */
  private async dutyOfSchool(
    tenantId: string,
    schoolId: string,
    dutyId: string,
  ): Promise<PioneerSchoolDuty> {
    const duty = await this.dutiesRepo.findOne({
      where: { id: dutyId, congregationId: tenantId },
    });
    if (!duty) throw new NotFoundException('Duty not found');
    const day = await this.daysRepo.findOne({
      where: { id: duty.dayId, schoolId },
    });
    if (!day) throw new NotFoundException('Duty not found');
    return duty;
  }

  async assignDuty(
    tenantId: string,
    schoolId: string,
    dutyId: string,
    dto: AssignPioneerSchoolDutyDto,
    user: AuthenticatedUser,
  ): Promise<PioneerSchoolDuty> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const duty = await this.dutyOfSchool(tenantId, schoolId, dutyId);
    if (dto.helperId) {
      const helper = await this.helpersRepo.findOne({
        where: { id: dto.helperId, congregationId: tenantId },
      });
      if (!helper) throw new NotFoundException('Helper not found');
    }
    const before = duty.helperId
      ? await this.helperName(tenantId, duty.helperId)
      : null;
    duty.helperId = dto.helperId ?? null;
    const saved = await this.dutiesRepo.save(duty);
    await this.syncAbsencesForSchool(tenantId, schoolId);
    // WHO put WHOM on WHICH role — the thing people come back and dispute
    // about a sheet that went out to twenty brothers. The school itself was
    // journalled from the start; the assignments, which are the whole content
    // of the schedule, were not.
    const day = await this.daysRepo.findOne({ where: { id: saved.dayId } });
    // The day and the role live in the field NAME rather than in a detail
    // blob: the journal shows «what changed, from what, to what», and a line
    // reading «25 ноября · microphone 2: Иванов → Петров» needs no lookup to
    // be understood a month later.
    const label = [
      day ? day.date.slice(0, 10) : '?',
      saved.customLabel ??
        `${saved.dutyType}${
          saved.dutyType === DutyType.MICROPHONE
            ? ` ${saved.slotIndex + 1}`
            : ''
        }`,
    ].join(' · ');
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'pioneer_school_duty',
      entityId: saved.id,
      before: { [label]: before },
      after: {
        [label]: dto.helperId
          ? await this.helperName(tenantId, dto.helperId)
          : null,
      },
      fields: [label],
    });
    return saved;
  }

  /**
   * Absences for the whole school, brought in line with who is standing where.
   *
   * Batch rather than per-duty, and run when the school is READ as well as
   * when a duty changes. Two reasons, both learned the hard way: assignments
   * made before this existed would otherwise never get an absence — nothing
   * would ever revisit them — and doing it one duty at a time meant four
   * queries per row, which for a week of four roles is a hundred queries to
   * open one screen.
   *
   * WHICH DAY counts is not «the weekday the settings name». It is asked of
   * the meeting rules themselves — the same ones the attendance card uses —
   * so a circuit visit that MOVES the midweek meeting moves this with it, and
   * a week replaced by an assembly produces no absence at all, because there
   * was no meeting to miss.
   *
   * Only our own brothers: a helper from another congregation has no card
   * here and nothing to be absent from.
   */
  private async syncAbsencesForSchool(
    tenantId: string,
    schoolId: string,
  ): Promise<void> {
    const days = await this.daysRepo.find({ where: { schoolId } });
    if (days.length === 0) return;
    const duties = await this.dutiesRepo.find({
      where: { dayId: In(days.map((d) => d.id)) },
    });
    const helpers = await this.helpersRepo.find({
      where: { congregationId: tenantId },
    });
    const publisherByHelper = new Map(
      helpers.filter((h) => h.publisherId).map((h) => [h.id, h.publisherId!]),
    );

    // Which of the school's days carry a midweek meeting of ours, asked once
    // per week rather than once per day.
    const weeks = [...new Set(days.map((d) => mondayOf(d.date.slice(0, 10))))];
    const meetingDates = new Set<string>();
    for (const week of weeks) {
      const meetings = await this.meetingAttendance.pendingForWeek(
        tenantId,
        week,
      );
      for (const m of meetings) {
        if (m.eventType === EventType.MIDWEEK) meetingDates.add(m.date);
      }
    }

    const dateById = new Map(days.map((d) => [d.id, d.date.slice(0, 10)]));
    /** duty id -> the absence it should produce, or nothing. */
    const wanted = new Map<string, { publisherId: string; date: string }>();
    for (const duty of duties) {
      const publisherId = duty.helperId
        ? publisherByHelper.get(duty.helperId)
        : undefined;
      const date = dateById.get(duty.dayId);
      if (!publisherId || !date || !meetingDates.has(date)) continue;
      wanted.set(duty.id, { publisherId, date });
    }

    const existing = await this.absencesRepo.find({
      where: {
        congregationId: tenantId,
        pioneerSchoolDutyId: In(duties.map((d) => d.id)),
      },
    });
    for (const row of existing) {
      const want = wanted.get(row.pioneerSchoolDutyId as string);
      if (
        want &&
        want.publisherId === row.publisherId &&
        want.date === row.startDate.slice(0, 10)
      ) {
        wanted.delete(row.pioneerSchoolDutyId as string);
        continue;
      }
      // The duty changed hands, moved, or was cleared: the absence the app
      // wrote goes with it. Absences a person entered carry no duty id and are
      // never touched.
      await this.absencesRepo.delete(row.id);
    }

    for (const [dutyId, want] of wanted) {
      await this.absencesRepo.save(
        this.absencesRepo.create({
          congregationId: tenantId,
          publisherId: want.publisherId,
          startDate: want.date,
          endDate: null,
          note: PIONEER_SCHOOL_ABSENCE_NOTE,
          pioneerSchoolDutyId: dutyId,
        }),
      );
    }
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
    const created = await this.dutiesRepo.save(
      this.dutiesRepo.create({
        congregationId: tenantId,
        dayId: day.id,
        dutyType: DutyType.CUSTOM,
        slotIndex,
        customLabel: dto.customLabel,
        helperId: dto.helperId ?? null,
      }),
    );
    await this.syncAbsencesForSchool(tenantId, schoolId);
    return created;
  }

  async removeCustomDuty(
    tenantId: string,
    schoolId: string,
    dutyId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.assertCanEdit(user);
    await this.getSchool(tenantId, schoolId);
    const duty = await this.dutyOfSchool(tenantId, schoolId, dutyId);
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

  /** A helper's name for the journal — an id in a journal explains nothing. */
  private async helperName(
    tenantId: string,
    helperId: string,
  ): Promise<string | null> {
    const helper = await this.helpersRepo.findOne({
      where: { id: helperId, congregationId: tenantId },
      withDeleted: true,
    });
    return helper ? `${helper.firstName} ${helper.lastName}`.trim() : null;
  }

  /** How many days each helper already holds — the load, for the picker. */
  async helperLoad(
    tenantId: string,
    schoolId: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, number>> {
    this.assertCanView(user);
    // The school has to be OURS. Without this, a school id from another
    // congregation answered with its day counts to any elder who asked —
    // small, but a leak is a leak.
    await this.getSchool(tenantId, schoolId);
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
