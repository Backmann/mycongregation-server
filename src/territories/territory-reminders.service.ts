import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { Territory } from '../entities/territory.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Congregation } from '../entities/congregation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { todayIn } from '../common/congregation-clock';
import { TERRITORY_KEEPERS } from './territory-access.service';
import { addDays } from './service-year';
import { dueSoonWords, takeBackWords } from './territory-words';

/** The holder hears this many days before his territory is due. */
export const DUE_SOON_DAYS = 14;

/**
 * The territory section's morning (11 November 2026):
 *  - two weeks before the day, the holder is reminded (once per due day — an
 *    extension sets a new day and so a new reminder);
 *  - a territory whose holder has left the congregation (his card removed,
 *    marked as moved away, or deleted) is reported to the territory servant
 *    and his assistant, once, so they take it back.
 *
 * A holder who has become inactive is not reported here: whether he is
 * inactive is the elders' to know, and their task «Замена назначений»
 * already lists his territory.
 */
@Injectable()
export class TerritoryRemindersService {
  private readonly logger = new Logger(TerritoryRemindersService.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritorySettings)
    private readonly settings: Repository<TerritorySettings>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  async tick(now = new Date()): Promise<{ due: number; takeBack: number }> {
    const open = await this.settings.find({
      where: { verifiedAt: Not(IsNull()) },
    });
    let due = 0;
    let takeBack = 0;
    for (const s of open) {
      try {
        const r = await this.forCongregation(s.congregationId, now);
        due += r.due;
        takeBack += r.takeBack;
      } catch (e) {
        this.logger.error(
          `territory reminders failed for ${s.congregationId}: ${String(e)}`,
        );
      }
    }
    return { due, takeBack };
  }

  async forCongregation(
    congregationId: string,
    now = new Date(),
  ): Promise<{ due: number; takeBack: number }> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    const today = todayIn(now, c?.timezone);
    const held = await this.assignments.find({
      where: {
        congregationId,
        completedOn: IsNull(),
        returnedOn: IsNull(),
        publisherId: Not(IsNull()),
      },
    });
    if (held.length === 0) return { due: 0, takeBack: 0 };
    const numbers = new Map(
      (
        await this.territories.find({
          where: { id: In([...new Set(held.map((a) => a.territoryId))]) },
          select: { id: true, number: true },
        })
      ).map((t) => [t.id, t.number]),
    );
    const people = new Map(
      (
        await this.publishers.find({
          where: { id: In([...new Set(held.map((a) => a.publisherId!))]) },
          select: {
            id: true,
            userId: true,
            isActive: true,
            removedAt: true,
            deletedAt: true,
          },
          withDeleted: true,
        })
      ).map((p) => [p.id, p]),
    );

    // Two weeks before.
    const soon = addDays(today, DUE_SOON_DAYS);
    let due = 0;
    for (const a of held) {
      if (a.dueOn !== soon) continue;
      const p = people.get(a.publisherId!);
      if (!p?.userId || p.removedAt || p.deletedAt || !p.isActive) continue;
      const number = numbers.get(a.territoryId) ?? '';
      await this.notifications.notify({
        tenantId: congregationId,
        userIds: [p.userId],
        kind: 'territory_due',
        key: `territory-due:${a.id}:${a.dueOn}`,
        text: (lang) => dueSoonWords(number, a.dueOn!, lang),
        data: { type: 'territory', territoryId: a.territoryId },
      });
      due += 1;
    }

    // Held by someone who has left.
    const gone = held.filter((a) => {
      const p = people.get(a.publisherId!);
      return !p || !!p.removedAt || !!p.deletedAt || !p.isActive;
    });
    if (gone.length > 0) {
      const keepers = await this.responsibilities.find({
        where: { congregationId, type: In(TERRITORY_KEEPERS) },
        select: { id: true, userId: true },
      });
      const userIds = [
        ...new Set(keepers.map((k) => k.userId).filter(Boolean)),
      ] as string[];
      for (const a of gone) {
        if (userIds.length === 0) break;
        const number = numbers.get(a.territoryId) ?? '';
        await this.notifications.notify({
          tenantId: congregationId,
          userIds,
          kind: 'territory_return',
          key: `territory-return:${a.id}`,
          text: (lang) => takeBackWords(number, lang),
          data: { type: 'territory_keeper', territoryId: a.territoryId },
        });
      }
    }
    return { due, takeBack: gone.length };
  }
}
