import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { CartWeek } from '../entities/cart-week.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { CongregationClock } from '../common/congregation-clock.service';
import { CartWeeksService, cartAddDays } from './cart-weeks.service';

/**
 * What the stand reminds of on its own, once a morning (2 November 2026):
 *
 *  - the day before sign-up closes — everyone approved who has not marked
 *    any time that week;
 *  - the day it closes — whoever arranges: put the plan together;
 *  - two days before a week begins and its plan is still not published —
 *    whoever arranges;
 *  - a month before a town permit for a place runs out — whoever arranges.
 *
 * Every message carries a key, so a second run the same day says nothing.
 */
@Injectable()
export class CartRemindersService {
  private readonly logger = new Logger(CartRemindersService.name);

  constructor(
    @InjectRepository(CartWeek)
    private readonly weeks: Repository<CartWeek>,
    @InjectRepository(CartLocation)
    private readonly locations: Repository<CartLocation>,
    @InjectRepository(CartRequest)
    private readonly requests: Repository<CartRequest>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
    private readonly clock: CongregationClock,
    private readonly cart: CartWeeksService,
  ) {}

  async tick(): Promise<void> {
    const all = await this.congregations.find({ select: { id: true } });
    for (const c of all) {
      try {
        await this.runFor(c.id);
      } catch (e) {
        this.logger.error(`cart reminders failed for ${c.id}: ${String(e)}`);
      }
    }
  }

  async runFor(congregationId: string): Promise<void> {
    const today = await this.clock.todayFor(congregationId);
    const tomorrow = cartAddDays(today, 1);
    const managers = await this.cart.managerUserIds(congregationId);

    const collecting = await this.weeks.find({
      where: {
        congregationId,
        status: 'collecting',
        signupUntil: Not(IsNull()),
      },
    });
    for (const w of collecting) {
      const until = String(w.signupUntil).slice(0, 10);
      if (until === tomorrow) {
        const asked: { publisher_id: string }[] = await this.requests.query(
          `SELECT DISTINCT r.publisher_id FROM cart_requests r
             JOIN cart_days d ON d.id = r.day_id WHERE d.week_id = $1`,
          [w.id],
        );
        const askedIds = new Set(asked.map((r) => r.publisher_id));
        const eligible = await this.cart.eligibleUserIds(congregationId);
        const pubs = eligible.length
          ? await this.publishers.find({
              where: { congregationId, userId: In(eligible) },
            })
          : [];
        const silent = pubs
          .filter((p) => !askedIds.has(p.id))
          .map((p) => p.userId as string);
        await this.cart.notify(
          congregationId,
          silent,
          (words) => ({
            title: words.signupTitle,
            body: words.signupBody(w.weekStartDate),
          }),
          { type: 'cart_signup_reminder', weekStart: w.weekStartDate },
          `cart-signup-remind:${w.id}`,
        );
      }
      if (until <= today) {
        await this.cart.notify(
          congregationId,
          managers,
          (words) => ({
            title: words.collectTitle,
            body: words.collectBody(w.weekStartDate),
          }),
          { type: 'cart_collect_due', weekStart: w.weekStartDate },
          `cart-collect:${w.id}`,
        );
      }
    }

    const soon = await this.weeks.find({
      where: { congregationId, status: Not('published') },
    });
    for (const w of soon) {
      const left =
        (Date.parse(`${w.weekStartDate}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
        86400000;
      if (left < 0 || left > 2) continue;
      const days: { n: number }[] = await this.requests.query(
        `SELECT count(*)::int AS n FROM cart_days WHERE week_id = $1`,
        [w.id],
      );
      if (!days[0]?.n) continue;
      await this.cart.notify(
        congregationId,
        managers,
        (words) => ({
          title: words.unpublishedTitle,
          body: words.unpublishedBody(w.weekStartDate),
        }),
        { type: 'cart_unpublished', weekStart: w.weekStartDate },
        `cart-unpublished:${w.id}`,
      );
    }

    const limit = cartAddDays(today, 30);
    const places = await this.locations.find({
      where: { congregationId, isActive: true, permitUntil: Not(IsNull()) },
    });
    for (const p of places) {
      const until = String(p.permitUntil).slice(0, 10);
      if (until > limit || until < today) continue;
      await this.cart.notify(
        congregationId,
        managers,
        (words) => ({
          title: words.permitTitle,
          body: words.permitBody(p.name, until),
        }),
        { type: 'cart_permit', locationId: p.id },
        `cart-permit:${p.id}:${until}`,
      );
    }
  }
}
