import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { PublisherDistinctPair } from '../entities/publisher-distinct-pair.entity';
import { alike, type AlikeBy } from '../publishers/duplicate-keys';
import { TaskRemindersService } from './task-reminders.service';

const KIND = 'possible_duplicate' as const;
/** The log's mark that a congregation's first, quiet pass is behind it. */
const ARMED = '-';

/** Two cards, in id order, as one 20-character period: ten of each. */
export function pairPeriod(x: string, y: string): string {
  const [a, b] = [x, y].sort();
  return a.replace(/-/g, '').slice(0, 10) + b.replace(/-/g, '').slice(0, 10);
}

export interface PossibleDuplicateCard {
  id: string;
  displayName: string;
  group: string | null;
  departed: boolean;
  createdAt: string;
  memberSince: string | null;
  hasAccount: boolean;
  reports: number;
}

/**
 * «Возможно, одна и та же карточка» (1 November 2026).
 *
 * The check while a card is entered catches a new duplicate; this catches
 * the ones already there — made before the check, or saved past it. For the
 * body of elders, one task per pair: «Объединить» (the secretary's) or «Это
 * разные люди», which is remembered so the pair is never raised again. The
 * task closes itself when the pair is gone — merged, renamed, or said to be
 * two people. A task an elder closed by hand is not raised again for that
 * pair.
 *
 * Names stay out of the stored task: the app writes the title from `kind`
 * and asks for the two cards here.
 */
@Injectable()
export class PossibleDuplicateService {
  private readonly logger = new Logger(PossibleDuplicateService.name);

  constructor(
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    @InjectRepository(ElderTask)
    private readonly tasks: Repository<ElderTask>,
    @InjectRepository(ElderTaskCalendarLog)
    private readonly log: Repository<ElderTaskCalendarLog>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    private readonly reminders: TaskRemindersService,
  ) {}

  private distinct(): Repository<PublisherDistinctPair> {
    return this.publishers.manager.getRepository(PublisherDistinctPair);
  }

  /** Every alike pair of a congregation, at least one card still in use. */
  async pairs(
    congregationId: string,
  ): Promise<Map<string, { a: string; b: string; why: AlikeBy[] }>> {
    const cards = await this.publishers.find({
      where: { congregationId },
      withDeleted: true,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        mobilePhone: true,
        deletedAt: true,
      },
    });
    const said = new Set(
      (await this.distinct().find({ where: { congregationId } })).map(
        (d) => `${d.aId}|${d.bId}`,
      ),
    );
    const out = new Map<string, { a: string; b: string; why: AlikeBy[] }>();
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const x = cards[i];
        const y = cards[j];
        if (x.deletedAt && y.deletedAt) continue;
        const why = alike(x, y);
        if (why.length === 0) continue;
        const [a, b] = [x.id, y.id].sort();
        if (said.has(`${a}|${b}`)) continue;
        out.set(pairPeriod(a, b), { a, b, why });
      }
    }
    return out;
  }

  async syncAll(): Promise<number> {
    const all = await this.congregations.find({ select: { id: true } });
    let changed = 0;
    for (const c of all) {
      try {
        changed += await this.sync(c.id);
      } catch (e) {
        this.logger.error(
          `possible duplicates failed for ${c.id}: ${String(e)}`,
        );
      }
    }
    if (changed > 0)
      this.logger.log(`possible-duplicate tasks changed: ${changed}`);
    return changed;
  }

  async sync(congregationId: string): Promise<number> {
    let changed = 0;
    const now = await this.pairs(congregationId);
    const raised = await this.tasks.find({
      where: { congregationId, kind: KIND },
    });
    for (const t of raised) {
      if (t.status === 'open' && !(t.kindPeriod && now.has(t.kindPeriod))) {
        await this.tasks.update(t.id, {
          status: 'done',
          doneAt: new Date(),
          doneById: null,
        });
        changed += 1;
      }
    }
    const offered = await this.log.find({
      where: { congregationId, kind: KIND },
    });
    for (const o of offered) {
      if (o.period === ARMED || now.has(o.period)) continue;
      // The pair is gone: should it come back, it is a new question.
      await this.log.delete({ congregationId, kind: KIND, period: o.period });
      await this.tasks.delete({
        congregationId,
        kind: KIND,
        kindPeriod: o.period,
        status: 'done',
      });
    }
    // The first pass finds whatever duplicates were there before this
    // existed: their tasks appear quietly, without a notice each.
    const firstPass = !offered.some((o) => o.period === ARMED);
    if (firstPass)
      await this.log.save(
        this.log.create({ congregationId, kind: KIND, period: ARMED }),
      );
    for (const [period] of now) {
      if (raised.some((t) => t.kindPeriod === period && t.status === 'open'))
        continue;
      if (offered.some((o) => o.period === period)) continue;
      const task = await this.tasks.save(
        this.tasks.create({
          congregationId,
          // A placeholder: the reader's own app writes the words from `kind`.
          title: KIND,
          details: null,
          area: 'organisation',
          assigneeKind: 'body_of_elders',
          assignees: [],
          dueDate: null,
          kind: KIND,
          kindPeriod: period,
          status: 'open',
          createdById: null,
        }),
      );
      await this.log.save(
        this.log.create({ congregationId, kind: KIND, period }),
      );
      if (!firstPass)
        await this.reminders
          .announceAssignment(task)
          .catch((e: unknown) =>
            this.logger.warn(`possible-duplicate notice failed: ${String(e)}`),
          );
      changed += 1;
    }
    return changed;
  }

  private async pairOf(
    congregationId: string,
    taskId: string,
  ): Promise<{ task: ElderTask; a: Publisher; b: Publisher }> {
    const task = await this.tasks.findOne({
      where: { id: taskId, congregationId, kind: KIND },
    });
    if (!task?.kindPeriod || task.kindPeriod.length !== 20)
      throw new NotFoundException('Task not found');
    const find = async (prefix: string) =>
      (
        await this.publishers
          .createQueryBuilder('p')
          .withDeleted()
          .leftJoinAndSelect('p.serviceGroup', 'g')
          .where('p.congregation_id = :congregationId', { congregationId })
          .andWhere(`replace(p.id::text, '-', '') LIKE :prefix`, {
            prefix: `${prefix}%`,
          })
          .getMany()
      )[0];
    const a = await find(task.kindPeriod.slice(0, 10));
    const b = await find(task.kindPeriod.slice(10));
    if (!a || !b) throw new NotFoundException('Task not found');
    return { task, a, b };
  }

  /** For the elders' task card: the two cards side by side. */
  async forTask(
    congregationId: string,
    taskId: string,
  ): Promise<{ cards: PossibleDuplicateCard[]; why: AlikeBy[] }> {
    const { a, b } = await this.pairOf(congregationId, taskId);
    const facts = async (p: Publisher): Promise<PossibleDuplicateCard> => {
      const [{ n }] = await this.publishers.manager.query(
        `SELECT count(*)::int AS n FROM service_reports WHERE publisher_id = $1 AND deleted_at IS NULL`,
        [p.id],
      );
      return {
        id: p.id,
        displayName: p.displayName,
        group: p.serviceGroup?.name ?? null,
        departed: !!p.deletedAt,
        createdAt: p.createdAt.toISOString(),
        memberSince: p.memberSince ?? null,
        hasAccount: !!p.userId,
        reports: n,
      };
    };
    return { cards: [await facts(a), await facts(b)], why: alike(a, b) };
  }

  /** «Это разные люди»: remembered for good, and the task closes now. */
  async markDistinct(
    congregationId: string,
    taskId: string,
    byUserId: string | null,
  ): Promise<void> {
    const { task, a, b } = await this.pairOf(congregationId, taskId);
    const [x, y] = [a.id, b.id].sort();
    await this.distinct().upsert({ congregationId, aId: x, bId: y, byUserId }, [
      'aId',
      'bId',
    ]);
    await this.tasks.update(task.id, {
      status: 'done',
      doneAt: new Date(),
      doneById: byUserId,
    });
  }
}
