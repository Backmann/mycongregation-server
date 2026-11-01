import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import { ElderTask } from '../entities/elder-task.entity';
import { ElderTaskCalendarLog } from '../entities/elder-task-calendar-log.entity';
import { Publisher } from '../entities/publisher.entity';
import { User } from '../entities/user.entity';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { periodOf } from './inactive-holds.service';
import { TaskRemindersService } from './task-reminders.service';

const KIND = 'admin_not_elder' as const;
/** The log's mark that a congregation's first, quiet pass is behind it. */
const ARMED = '-';

/**
 * «Администратор не старейшина: [имя]» (1 November 2026).
 *
 * Only an elder may be made an administrator — the server refuses anyone
 * else. But a brother can stop being an elder while he holds the role, and
 * the server does not take it from him: the congregation must never be left
 * without an administrator, and whom to give it to is the elders' decision.
 * So the elders are told, by a task that closes itself when the role is
 * changed or he is an elder again. A task an elder closed stays closed until
 * the case ends and comes back.
 */
@Injectable()
export class AdminNotElderService {
  private readonly logger = new Logger(AdminNotElderService.name);

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

  private users(): Repository<User> {
    return this.publishers.manager.getRepository(User);
  }

  /** Active administrators of a congregation whose card is not an elder's. */
  async offenders(congregationId: string): Promise<User[]> {
    const admins = await this.users().find({
      where: { congregationId, role: UserRole.ADMIN, isActive: true },
    });
    const out: User[] = [];
    for (const u of admins) {
      const card = await this.publishers.findOne({
        where: { congregationId, userId: u.id },
        select: { id: true, appointment: true },
      });
      if (card?.appointment !== PublisherAppointment.ELDER) out.push(u);
    }
    return out;
  }

  async syncAll(): Promise<number> {
    const congregations = await this.congregations.find({
      select: { id: true },
    });
    let changed = 0;
    for (const c of congregations) {
      try {
        changed += await this.sync(c.id);
      } catch (e) {
        this.logger.error(`admin-not-elder failed for ${c.id}: ${String(e)}`);
      }
    }
    if (changed > 0)
      this.logger.log(`admin-not-elder tasks changed: ${changed}`);
    return changed;
  }

  async sync(congregationId: string): Promise<number> {
    let changed = 0;
    const now = new Map(
      (await this.offenders(congregationId)).map((u) => [periodOf(u.id), u]),
    );
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
      await this.log.delete({ congregationId, kind: KIND, period: o.period });
      await this.tasks.delete({
        congregationId,
        kind: KIND,
        kindPeriod: o.period,
        status: 'done',
      });
    }
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
            this.logger.warn(`admin-not-elder notice failed: ${String(e)}`),
          );
      changed += 1;
    }
    return changed;
  }

  /** For the elders' task card: whose account it is. */
  async forTask(
    congregationId: string,
    taskId: string,
  ): Promise<{ name: string }> {
    const task = await this.tasks.findOne({
      where: { id: taskId, congregationId, kind: KIND },
    });
    if (!task?.kindPeriod) throw new NotFoundException('Task not found');
    const [u] = await this.users()
      .createQueryBuilder('u')
      .withDeleted()
      .where('u.congregation_id = :congregationId', { congregationId })
      .andWhere(`replace(u.id::text, '-', '') LIKE :prefix`, {
        prefix: `${task.kindPeriod}%`,
      })
      .getMany();
    if (!u) throw new NotFoundException('Task not found');
    const card = await this.publishers.findOne({
      where: { congregationId, userId: u.id },
      withDeleted: true,
    });
    return { name: card?.displayName ?? u.loginName ?? u.email ?? '—' };
  }
}
