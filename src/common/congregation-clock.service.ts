import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Congregation } from '../entities/congregation.entity';
import {
  DEFAULT_CONGREGATION_TIMEZONE,
  minutesOfDayIn,
  todayIn,
} from './congregation-clock';

/**
 * The one place that answers "what time is it for this congregation".
 *
 * Deliberately not cached. The lookup is a primary-key read of one row, and a
 * cache here would mean a congregation that corrects its timezone in the
 * settings keeps getting the old answer for as long as the cache lives —
 * paying for a query nobody was waiting on with a wrong date somebody was.
 * Callers that iterate over many publishers read the timezone once themselves
 * and pass it down.
 */
@Injectable()
export class CongregationClock {
  constructor(
    @InjectRepository(Congregation)
    private readonly congregationsRepo: Repository<Congregation>,
  ) {}

  /** The congregation's IANA timezone, or the default when none is set. */
  async timezoneOf(tenantId: string): Promise<string> {
    const congregation = await this.congregationsRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'timezone'],
    });
    return congregation?.timezone || DEFAULT_CONGREGATION_TIMEZONE;
  }

  /** The congregation's own date, 'YYYY-MM-DD'. */
  async todayFor(tenantId: string): Promise<string> {
    return todayIn(new Date(Date.now()), await this.timezoneOf(tenantId));
  }

  /** Minutes since midnight, by the congregation's clock. */
  async minutesOfDayFor(tenantId: string): Promise<number> {
    return minutesOfDayIn(
      new Date(Date.now()),
      await this.timezoneOf(tenantId),
    );
  }
}
