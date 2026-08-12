import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';

/**
 * Who a task addressed to a body actually reaches, and who may audit accounts.
 *
 * The membership is READ, never stored. A task set in May and still open in
 * July belongs to whoever holds the office in July — that is what everybody
 * means by «the service committee», and storing three names in May would have
 * quietly contradicted it the first time somebody was replaced. Lionel put it
 * plainly: these are assignments, and assignments can be temporary.
 *
 * The service committee is three assignments; the body of elders is everybody
 * appointed as an elder. The committee is PART of the body, not a group beside
 * it — so a brother can be reached by both, and that is not a mistake to
 * correct.
 */
@Injectable()
export class TaskAddresseesService {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
  ) {}

  /** The three assignments that make up the service committee. */
  static readonly SERVICE_COMMITTEE = [
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.SECRETARY,
    ResponsibilityType.SERVICE_OVERSEER,
  ];

  /** Cards of whoever holds any of these responsibilities right now. */
  private async byResponsibility(
    congregationId: string,
    types: ResponsibilityType[],
  ): Promise<Publisher[]> {
    const held = await this.responsibilities.find({
      where: { congregationId, type: In(types) },
    });
    const userIds = held.map((r) => r.userId).filter(Boolean);
    if (userIds.length === 0) return [];
    return this.publishers.find({
      where: { congregationId, userId: In(userIds) },
    });
  }

  /** Everyone appointed as an elder — the body. */
  private async elders(congregationId: string): Promise<Publisher[]> {
    return this.publishers.find({
      where: {
        congregationId,
        appointment: PublisherAppointment.ELDER,
        removedAt: IsNull(),
      },
    });
  }

  /** Whom this task reaches, whichever way it was addressed. */
  async membersOf(task: ElderTask): Promise<Publisher[]> {
    if (task.assigneeKind === 'service_committee') {
      return this.byResponsibility(
        task.congregationId,
        TaskAddresseesService.SERVICE_COMMITTEE,
      );
    }
    if (task.assigneeKind === 'body_of_elders') {
      return this.elders(task.congregationId);
    }
    return task.assignees ?? [];
  }

  /**
   * Why a brother must not audit the accounts, or null when he may.
   *
   * Two of these are refusals and one is a caution, and the difference is
   * Lionel's: the secretary and the accounts servant are barred outright,
   * while «not the same brother twice running» is advice, because sometimes
   * there is nobody else to ask. The app says so and lets the body decide —
   * the same shape as every other warning here.
   */
  async auditObjection(
    congregationId: string,
    publisherId: string,
  ): Promise<'isSecretary' | 'keepsAccounts' | 'didPrevious' | null> {
    const card = await this.publishers.findOne({
      where: { id: publisherId, congregationId },
    });
    if (!card?.userId) return null;

    const held = await this.responsibilities.find({
      where: {
        congregationId,
        userId: card.userId,
        type: In([
          ResponsibilityType.SECRETARY,
          ResponsibilityType.ACCOUNTS_SERVANT,
        ]),
      },
    });
    if (held.some((r) => r.type === ResponsibilityType.SECRETARY)) {
      return 'isSecretary';
    }
    if (held.some((r) => r.type === ResponsibilityType.ACCOUNTS_SERVANT)) {
      return 'keepsAccounts';
    }

    // One previous check, not two: the rule speaks of consecutive audits.
    const previous = await this.tasks.findOne({
      where: { congregationId, kind: 'accounts_audit', kindPeriod: Not('') },
      order: { kindPeriod: 'DESC' },
      relations: { assignees: true },
    });
    const didPrevious = previous?.assignees?.some((p) => p.id === publisherId);
    return didPrevious ? 'didPrevious' : null;
  }
}
