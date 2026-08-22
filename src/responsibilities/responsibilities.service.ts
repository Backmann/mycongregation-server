import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AssignResponsibilityDto } from './dto/assign-responsibility.dto';

/**
 * A responsibility as the screen needs it: the record, plus the names behind
 * the two ids in it. The ids stay — the app matches on them — and the names
 * ride along so nobody has to look anybody up.
 */
export interface ResponsibilityView extends Responsibility {
  holderName: string | null;
  assignedByName: string | null;
}

/**
 * Responsibilities held by ONE brother at a time — that is, all but one.
 *
 * There is one secretary, one service overseer, one brother who keeps the
 * public witnessing list. Assigning such a duty to somebody else means the
 * previous holder steps down, and the screen says «Заменить» rather than
 * offering to add a second.
 *
 * The exception is the study conductor's assistant: a congregation keeps a
 * couple of men able to stand in, and both are genuinely appointed.
 */
const MULTI_HOLDER: ResponsibilityType[] = [
  ResponsibilityType.WT_STUDY_CONDUCTOR_BACKUP,
];

@Injectable()
export class ResponsibilitiesService {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * All responsibilities currently assigned, with the names behind the ids.
   *
   * The screen showed twelve e-mail addresses in a column, because that was
   * all it had. And `assigned_at` / `assigned_by` have been written since the
   * table was created and never left the server: «кто и когда» was recorded
   * and unreadable, which is the same as not recorded.
   */
  async findAll(tenantId: string): Promise<ResponsibilityView[]> {
    const rows = await this.responsibilitiesRepo.find({
      where: { congregationId: tenantId },
      // The type first, then oldest assignment first, so the order is the same
      // on every reload — unordered rows swap places and look like a change.
      order: { type: 'ASC', assignedAt: 'ASC' },
    });
    if (rows.length === 0) return [];

    const names = await this.namesOf(tenantId, [
      ...rows.map((r) => r.userId),
      ...rows
        .map((r) => r.assignedBy)
        .filter(Boolean as unknown as () => boolean),
    ] as string[]);

    return rows.map((r) => ({
      ...r,
      holderName: names.get(r.userId) ?? null,
      assignedByName: r.assignedBy ? (names.get(r.assignedBy) ?? null) : null,
    }));
  }

  /**
   * Publisher-card names for a set of accounts, in one query.
   *
   * The card first, because that is how the brothers know each other; an
   * account with no card falls back to its login name — an administrator who
   * is not a publisher here still has one, and an id explains nothing.
   */
  private async namesOf(
    congregationId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();

    const cards = await this.publishersRepo.find({
      where: { congregationId, userId: In(ids) },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    const out = new Map<string, string>();
    for (const c of cards) {
      if (!c.userId) continue;
      const full = [c.lastName, c.firstName].filter(Boolean).join(' ').trim();
      if (full) out.set(c.userId, full);
    }

    const missing = ids.filter((id) => !out.has(id));
    if (missing.length > 0) {
      const users = await this.usersRepo.find({
        where: { id: In(missing), congregationId },
        select: { id: true, loginName: true },
      });
      for (const u of users) {
        if (u.loginName) out.set(u.id, u.loginName);
      }
    }
    return out;
  }

  /**
   * Give a responsibility to a brother — and to him alone.
   *
   * ONE HOLDER PER RESPONSIBILITY, which is how the congregation works: there
   * is one secretary, one service overseer, one brother who keeps the public
   * witnessing list. Assigning it to somebody else therefore REPLACES the
   * previous holder rather than standing beside him.
   *
   * The comment here used to promise exactly that and the code did not do it —
   * the unique key is on (congregation, type, USER), so a second assignment
   * simply added a second holder. Half the screen could quietly end up with
   * two men responsible for one thing and neither of them told.
   *
   * The replacement is journalled as a removal and a grant, not as a silent
   * swap: a privilege changing hands is precisely what a journal is for.
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
      where: { congregationId: tenantId, type: dto.type, userId: dto.userId },
    });
    if (existing) {
      // Already assigned to this person — assignment is idempotent.
      return existing;
    }

    // Anybody else holding it steps down first — unless several may hold it.
    if (MULTI_HOLDER.includes(dto.type)) {
      return this.grant(tenantId, dto, assignedBy);
    }
    const others = await this.responsibilitiesRepo.find({
      where: { congregationId: tenantId, type: dto.type },
    });
    for (const previous of others) {
      await this.auditLog.logEvent({
        tenantId,
        entityType: 'responsibility',
        entityId: previous.id,
        action: 'DELETE',
        subjectId: previous.userId,
        detail: {
          type: previous.type,
          userId: previous.userId,
          replaced: true,
        },
      });
      await this.responsibilitiesRepo.remove(previous);
    }

    return this.grant(tenantId, dto, assignedBy);
  }

  /**
   * Write the appointment down. Shared by both paths so that a duty several
   * men may hold is recorded exactly like one only a single man may.
   */
  private async grant(
    tenantId: string,
    dto: AssignResponsibilityDto,
    assignedBy: string,
  ): Promise<Responsibility> {
    const created = this.responsibilitiesRepo.create({
      congregationId: tenantId,
      type: dto.type,
      userId: dto.userId,
      assignedBy,
    });
    const saved = await this.responsibilitiesRepo.save(created);
    // A responsibility is a privilege in the congregation, so who granted it
    // and to whom is exactly what a journal exists to answer.
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'responsibility',
      entityId: saved.id,
      subjectId: dto.userId,
      after: { type: saved.type, userId: saved.userId },
    });
    return saved;
  }

  /** Removes one person's responsibility assignment. */
  async revoke(
    tenantId: string,
    type: ResponsibilityType,
    userId: string,
  ): Promise<void> {
    const existing = await this.responsibilitiesRepo.findOne({
      where: { congregationId: tenantId, type, userId },
    });
    if (!existing) {
      throw new NotFoundException('Responsibility is not assigned');
    }
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'responsibility',
      entityId: existing.id,
      action: 'DELETE',
      subjectId: userId,
      detail: { type, userId },
    });
    await this.responsibilitiesRepo.remove(existing);
  }
}
