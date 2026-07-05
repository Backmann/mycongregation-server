import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { TalkExchangeDirection } from '../common/enums/talk-exchange.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateTalkExchangeDto } from './dto/create-talk-exchange.dto';
import { UpdateTalkExchangeDto } from './dto/update-talk-exchange.dto';

const PUBLIC_TALK_PART_KEY = 'public_talk_speaker';

/** Monday (YYYY-MM-DD) of the ISO week containing the given date. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const isoDow = dow === 0 ? 7 : dow; // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}

/** dateStr + n days, as YYYY-MM-DD (UTC). */
function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function speakerFullName(s: {
  firstName: string;
  lastName: string | null;
}): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}

export type TalkExchangeResult = TalkExchange & { programConflict?: boolean };

@Injectable()
export class TalkExchangeService {
  constructor(
    @InjectRepository(TalkExchange)
    private readonly repo: Repository<TalkExchange>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Absence)
    private readonly absenceRepo: Repository<Absence>,
    @InjectRepository(VisitingSpeaker)
    private readonly speakerRepo: Repository<VisitingSpeaker>,
    @InjectRepository(ExternalCongregation)
    private readonly congregationRepo: Repository<ExternalCongregation>,
    @InjectRepository(PublicTalk)
    private readonly publicTalkRepo: Repository<PublicTalk>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(MeetingSettings)
    private readonly meetingSettingsRepo: Repository<MeetingSettings>,
  ) {}

  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.PUBLIC_TALK_COORDINATOR,
  ];

  private async assertCanWrite(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(TalkExchangeService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        'Only the public talk coordinator may edit the talk exchange',
      );
    }
  }

  findAll(tenantId: string): Promise<TalkExchange[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: { date: 'DESC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<TalkExchange> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!row) throw new NotFoundException('Talk exchange entry not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = this.repo.create({ ...fields, congregationId: tenantId });
    const saved = await this.repo.save(row);
    return this.applySideEffects(tenantId, saved, overwriteProgram);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = await this.findOne(tenantId, id);
    Object.assign(row, fields);
    const saved = await this.repo.save(row);
    return this.applySideEffects(tenantId, saved, overwriteProgram);
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    // Remove the auto-created outgoing absence.
    if (row.linkedAbsenceId) {
      await this.absenceRepo.softDelete(row.linkedAbsenceId);
    }
    // Incoming is kept in sync with the program's public-talk slot: removing the
    // journal entry clears that slot (when it still reflects this visitor).
    if (row.direction === TalkExchangeDirection.INCOMING) {
      await this.clearProgramSlot(tenantId, row);
    }
    await this.repo.softDelete(row.id);
  }

  /** Clear the weekend public-talk slot if it still reflects an invited speaker. */
  private async clearProgramSlot(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate: mondayOf(entry.date),
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return;
    // A local-brother slot isn't ours to wipe; only clear an invited/empty slot.
    if (slot.publisherId) return;
    if (!slot.speakerName && !slot.publicTalkId) return;
    slot.speakerName = null;
    slot.speakerCongregation = null;
    slot.publicTalkId = null;
    slot.partTitle = null;
    if (slot.status === AssignmentStatus.PUBLISHED)
      slot.changedSincePublish = true;
    await this.assignmentRepo.save(slot);
  }

  // ---- Side effects -------------------------------------------------------

  private async applySideEffects(
    tenantId: string,
    entry: TalkExchange,
    overwriteProgram?: boolean,
  ): Promise<TalkExchangeResult> {
    if (entry.direction === TalkExchangeDirection.INCOMING) {
      return this.applyIncomingToProgram(
        tenantId,
        entry,
        overwriteProgram ?? false,
      );
    }
    if (entry.direction === TalkExchangeDirection.OUTGOING) {
      await this.syncOutgoingAbsence(tenantId, entry);
    }
    return entry;
  }

  /**
   * Fill the weekend public-talk slot for the entry's week with the visiting
   * speaker + talk. If the slot is already filled with something else and
   * overwrite is false, leave it and flag a conflict for the app to confirm.
   */
  private async applyIncomingToProgram(
    tenantId: string,
    entry: TalkExchange,
    overwrite: boolean,
  ): Promise<TalkExchangeResult> {
    if (!entry.publicTalkId) return entry;

    const localPublisherId = entry.publisherId ?? null;
    let name: string | null = null;
    let congName: string | null = null;
    if (!localPublisherId) {
      if (entry.visitingSpeakerId) {
        const speaker = await this.speakerRepo.findOne({
          where: { id: entry.visitingSpeakerId, congregationId: tenantId },
          relations: { externalCongregation: true },
        });
        if (speaker) {
          name = speakerFullName(speaker);
          congName = speaker.externalCongregation?.name ?? null;
        }
      }
      if (!name && entry.speakerName?.trim()) {
        name = entry.speakerName.trim();
        congName = entry.speakerCongregation?.trim() || null;
      }
      if (!name) return entry; // nothing to fill the slot with
    }

    const weekStartDate = mondayOf(entry.date);
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return entry; // no weekend programme for that week yet

    const alreadyThis = localPublisherId
      ? slot.publisherId === localPublisherId &&
        slot.publicTalkId === entry.publicTalkId
      : slot.publicTalkId === entry.publicTalkId && slot.speakerName === name;
    const occupied = !!(
      slot.publisherId ||
      slot.publicTalkId ||
      slot.speakerName?.trim()
    );

    if (occupied && !overwrite && !alreadyThis) {
      const result = entry as TalkExchangeResult;
      result.programConflict = true;
      return result;
    }

    if (localPublisherId) {
      slot.publisherId = localPublisherId;
      slot.speakerName = null;
      slot.speakerCongregation = null;
    } else {
      slot.publisherId = null;
      slot.speakerName = name;
      slot.speakerCongregation = congName;
    }
    slot.publicTalkId = entry.publicTalkId;
    const talk = await this.publicTalkRepo.findOne({
      where: { id: entry.publicTalkId },
    });
    slot.partTitle = talk ? `№${talk.number}. ${talk.title}` : slot.partTitle;
    if (slot.status === AssignmentStatus.PUBLISHED) {
      slot.changedSincePublish = true;
    }
    await this.assignmentRepo.save(slot);
    return entry;
    return entry;
  }

  /**
   * Keep an absence in sync for an outgoing brother (he is away that day).
   * Creates on first sync, updates on change, removes if the brother is
   * cleared.
   */
  private async syncOutgoingAbsence(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    if (!entry.publisherId) {
      if (entry.linkedAbsenceId) {
        await this.absenceRepo.softDelete(entry.linkedAbsenceId);
        entry.linkedAbsenceId = null;
        await this.repo.save(entry);
      }
      return;
    }

    const note = await this.buildOutgoingNote(tenantId, entry);

    if (entry.linkedAbsenceId) {
      const abs = await this.absenceRepo.findOne({
        where: { id: entry.linkedAbsenceId, congregationId: tenantId },
      });
      if (abs) {
        abs.publisherId = entry.publisherId;
        abs.startDate = entry.date;
        abs.endDate = null;
        abs.note = note;
        await this.absenceRepo.save(abs);
        return;
      }
    }

    const abs = this.absenceRepo.create({
      congregationId: tenantId,
      publisherId: entry.publisherId,
      startDate: entry.date,
      note: note ?? undefined,
    });
    const savedAbs = await this.absenceRepo.save(abs);
    entry.linkedAbsenceId = savedAbs.id;
    await this.repo.save(entry);
  }

  private async buildOutgoingNote(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<string | null> {
    const parts: string[] = [];
    if (entry.publicTalkId) {
      const talk = await this.publicTalkRepo.findOne({
        where: { id: entry.publicTalkId },
      });
      if (talk) parts.push(`№${talk.number}`);
    }
    if (entry.hostCongregationId) {
      const cong = await this.congregationRepo.findOne({
        where: { id: entry.hostCongregationId, congregationId: tenantId },
      });
      if (cong) parts.push(cong.name);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  // ---- Program -> Journal sync -------------------------------------------

  /** The weekend meeting date for a week, per the meeting-settings version in force. */
  private async weekendDateFor(
    tenantId: string,
    weekStartDate: string,
  ): Promise<string> {
    const version = await this.meetingSettingsRepo.findOne({
      where: { congregationId: tenantId },
      order: { effectiveFrom: 'DESC' },
    });
    const dow = version?.weekendDow ?? 7; // default Sunday
    return addDaysISO(weekStartDate, dow - 1);
  }

  /**
   * Keep the journal's incoming entry in sync with the program's weekend
   * public-talk slot for a week. Only invited speakers (free-text speakerName,
   * no local publisher) map to a "К нам" entry. Called after the schedule edits
   * a public_talk_speaker assignment. Writes directly (no further side effects)
   * and is idempotent, so it never loops with applyIncomingToProgram.
   */
  async syncProgramToJournal(
    tenantId: string,
    weekStartDate: string,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });

    // Find the existing incoming journal entry for this week (if any).
    const weekEnd = addDaysISO(weekStartDate, 6);
    const existing = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, weekEnd),
      },
    });

    // A cancelled week (congress, memorial, ...) counts as "no speaker":
    // its journal entry must not survive the cancellation.
    const active = slot && slot.status !== AssignmentStatus.CANCELLED;
    const hasLocal = !!(active && slot.publisherId);
    const hasInvited = !!(
      active &&
      !slot.publisherId &&
      slot.speakerName?.trim()
    );

    if (!hasLocal && !hasInvited) {
      // Program has no weekend speaker -> remove any journal incoming entry.
      if (existing) await this.repo.softDelete(existing.id);
      return;
    }

    const publicTalkId = slot!.publicTalkId ?? null;

    if (hasLocal) {
      const publisherId = slot!.publisherId!;
      if (existing) {
        const same =
          existing.publisherId === publisherId &&
          existing.visitingSpeakerId == null &&
          existing.speakerName == null &&
          existing.publicTalkId === publicTalkId;
        if (same) return;
        existing.publisherId = publisherId;
        existing.visitingSpeakerId = null;
        existing.speakerName = null;
        existing.speakerCongregation = null;
        existing.publicTalkId = publicTalkId;
        await this.repo.save(existing);
        return;
      }
      const entry = this.repo.create({
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: await this.weekendDateFor(tenantId, weekStartDate),
        publisherId,
        publicTalkId,
      });
      await this.repo.save(entry);
      return;
    }

    const speakerName = slot!.speakerName!.trim();
    const speakerCongregation = slot!.speakerCongregation?.trim() || null;

    if (existing) {
      const currentName =
        existing.visitingSpeakerId == null ? existing.speakerName : null;
      const same =
        existing.publisherId == null &&
        currentName === speakerName &&
        existing.speakerCongregation === speakerCongregation &&
        existing.publicTalkId === publicTalkId;
      if (same) return; // idempotent: nothing changed
      existing.publisherId = null;
      existing.visitingSpeakerId = null;
      existing.speakerName = speakerName;
      existing.speakerCongregation = speakerCongregation;
      existing.publicTalkId = publicTalkId;
      await this.repo.save(existing);
      return;
    }

    const entry = this.repo.create({
      congregationId: tenantId,
      direction: TalkExchangeDirection.INCOMING,
      date: await this.weekendDateFor(tenantId, weekStartDate),
      speakerName,
      speakerCongregation,
      publicTalkId,
    });
    await this.repo.save(entry);
  }
}
