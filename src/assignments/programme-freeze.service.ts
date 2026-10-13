import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { WeekRulesService } from '../common/week-rules.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { refusal } from '../common/errors/refusal';
import { ProgrammeLock, programmeLock } from './programme-freeze';

/** A meeting of a week, as the programme rows name it. */
export interface ProgrammeMeetingRef {
  weekStartDate: string;
  eventType: string;
}

/**
 * The one door every write to the programme passes (13 October 2026).
 *
 * The rule is in programme-freeze.ts; this asks it with the congregation's
 * own week rules and its own day — never the server's clock — and says
 * three things: how a meeting stands, whether a write may go ahead, and
 * whether that write is a FIX after the fact.
 *
 * A fix after the fact is for the administrator and the coordinator of the
 * body of elders only (Lionel, 13 October 2026): the programme is the one
 * record the history of parts is counted from, so a wrong name must be
 * correctable — but by those who answer for the record, on purpose, and
 * marked as such in the journal.
 */
@Injectable()
export class ProgrammeFreezeService {
  constructor(
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
    private readonly auditLog: AuditLogService,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
  ) {}

  /** How each asked meeting stands, keyed `week|eventType`. One set of queries. */
  async locks(
    congregationId: string,
    meetings: ProgrammeMeetingRef[],
  ): Promise<Map<string, ProgrammeLock>> {
    const out = new Map<string, ProgrammeLock>();
    if (meetings.length === 0) return out;
    const weeks = [
      ...new Set(meetings.map((m) => m.weekStartDate.slice(0, 10))),
    ];
    const [rules, today] = await Promise.all([
      this.weekRules.forWeeks(congregationId, weeks),
      this.clock.todayFor(congregationId),
    ]);
    for (const m of meetings) {
      const week = m.weekStartDate.slice(0, 10);
      const r = rules.get(week);
      if (!r) continue;
      out.set(`${week}|${m.eventType}`, programmeLock(r, m.eventType, today));
    }
    return out;
  }

  async lockOf(
    congregationId: string,
    meeting: ProgrammeMeetingRef,
  ): Promise<ProgrammeLock> {
    const locks = await this.locks(congregationId, [meeting]);
    return locks.get(
      `${meeting.weekStartDate.slice(0, 10)}|${meeting.eventType}`,
    )!;
  }

  /** Whether this person may put a frozen programme right. */
  async mayFixAfterwards(
    user: AuthenticatedUser | undefined,
  ): Promise<boolean> {
    if (!user) return false;
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilities.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: ResponsibilityType.BODY_COORDINATOR,
      },
    });
    return held > 0;
  }

  /**
   * May these meetings' programmes be written? Returns `retroactive: true`
   * when at least one is frozen and the caller asked to fix it after the
   * fact and may. Refuses — before anything is written — when one is
   * frozen and the write is an ordinary one, or the fix is not theirs.
   *
   * Every meeting of a bulk write is checked first, so a request touching
   * an open week and a frozen one writes nothing at all rather than half.
   */
  async assertWritable(
    congregationId: string,
    meetings: ProgrammeMeetingRef[],
    opts: { retroactive?: boolean; user?: AuthenticatedUser } = {},
  ): Promise<{ retroactive: boolean }> {
    const locks = await this.locks(congregationId, meetings);
    const frozen = [...locks.entries()].filter(([, l]) => l.frozen);
    if (frozen.length === 0) return { retroactive: false };
    const [key, lock] = frozen.sort(([a], [b]) => a.localeCompare(b))[0];
    const [weekStartDate, eventType] = key.split('|');
    if (opts.retroactive) {
      if (await this.mayFixAfterwards(opts.user)) return { retroactive: true };
      throw new ForbiddenException(
        refusal(
          'PROGRAMME_FIX_FORBIDDEN',
          'Only an administrator or the coordinator of the body of elders may correct a programme that has become the record.',
        ),
      );
    }
    // The refusal is worth a line in the journal, as for duties: «who tried
    // to change last month's programme» is a question it gets asked.
    await this.auditLog.logEvent({
      tenantId: congregationId,
      entityType: 'assignment',
      entityId: congregationId,
      action: 'DENY',
      detail: { reason: 'programme_frozen', weekStartDate, eventType },
    });
    throw new ConflictException(
      refusal(
        'PROGRAMME_PAST_LOCKED',
        'This meeting was held more than a week ago; its programme is part of the record and can no longer be changed.',
        { date: lock.meetingDate, until: lock.editableUntil },
      ),
    );
  }

  /** True when the meeting's programme is the record — for quiet skips. */
  async isFrozen(
    congregationId: string,
    meeting: ProgrammeMeetingRef,
  ): Promise<boolean> {
    return (await this.lockOf(congregationId, meeting)).frozen;
  }
}
