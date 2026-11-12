import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import { TerritoryNoCall } from '../entities/territory-no-call.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import { TerritoryAccessService } from './territory-access.service';
import { addDays } from './service-year';
import type { CreateNoCallDto, UpdateNoCallDto } from './dto/no-call.dto';

/** Two years after it was noted, the address comes up for review. */
export const NO_CALL_REVIEW_DAYS = 730;
/** The review is announced this many days ahead. */
export const NO_CALL_REVIEW_AHEAD = 30;

/**
 * The same address however it is written: case, spaces, hyphens and dots
 * aside, and «Straße», «Strasse», «Str.» read alike.
 */
export function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/strasse\b|str\.?(?=\s|\d|$)/g, 'str')
    .replace(/[\s.,\-–]+/g, '');
}

/**
 * «Не посещать» addresses kept by hand (12 November 2026).
 *
 * The territory servant and his assistant do everything: add, correct,
 * delete, keep for two more years. The service committee may decide only
 * when an address is up for review (Lionel, 12 November 2026). The journal
 * records that something changed and on which territory, never the address
 * itself — the same rule as for contact details.
 */
@Injectable()
export class TerritoryNoCallsService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryNoCall)
    private readonly noCalls: Repository<TerritoryNoCall>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  private async today(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  private async territoryOf(user: AuthenticatedUser, id: string) {
    const t = await this.territories.findOne({
      where: { id, congregationId: user.congregationId, archivedAt: IsNull() },
    });
    if (!t) throw new NotFoundException('Territory not found');
    return t;
  }

  private async noCallOf(user: AuthenticatedUser, id: string) {
    const n = await this.noCalls.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!n) throw new NotFoundException('Address not found');
    return n;
  }

  private async mustBeUnique(
    territoryId: string,
    address: string,
    except?: string,
  ) {
    const key = addressKey(address);
    const all = await this.noCalls.find({ where: { territoryId } });
    if (all.some((n) => n.id !== except && addressKey(n.address) === key)) {
      throw new BadRequestException(
        refusal('TERRITORY_NO_CALL_TWICE', 'This address is already noted.'),
      );
    }
  }

  private mustNotBeFuture(notedOn: string, today: string) {
    if (notedOn > today) {
      throw new BadRequestException(
        refusal('TERRITORY_DATES', 'The date is in the future.'),
      );
    }
  }

  /** The keepers always; the committee only for an address up for review. */
  private async mustDecide(user: AuthenticatedUser, n: TerritoryNoCall) {
    const a = await this.access.mustSeeAll(user);
    if (a.keeps) return;
    const today = await this.today(user.congregationId);
    if (n.reviewOn > addDays(today, NO_CALL_REVIEW_AHEAD)) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Requires the territory servant.'),
      );
    }
  }

  private shape(n: TerritoryNoCall) {
    return {
      id: n.id,
      address: n.address,
      surname: n.surname,
      notedOn: n.notedOn,
      reviewOn: n.reviewOn,
    };
  }

  private log(
    user: AuthenticatedUser,
    n: TerritoryNoCall,
    number: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    detail: Record<string, unknown>,
  ) {
    return this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_no_call',
      entityId: n.id,
      action,
      actorUserId: user.id,
      detail: { territory: number, ...detail },
    });
  }

  async create(
    user: AuthenticatedUser,
    territoryId: string,
    dto: CreateNoCallDto,
  ) {
    await this.access.mustKeep(user);
    const t = await this.territoryOf(user, territoryId);
    const today = await this.today(user.congregationId);
    const notedOn = dto.notedOn ?? today;
    this.mustNotBeFuture(notedOn, today);
    const address = dto.address.trim();
    await this.mustBeUnique(t.id, address);
    const n = await this.noCalls.save(
      this.noCalls.create({
        congregationId: user.congregationId,
        territoryId: t.id,
        address,
        surname: dto.surname?.trim() || null,
        notedOn,
        reviewOn: addDays(notedOn, NO_CALL_REVIEW_DAYS),
        createdByUserId: user.id,
      }),
    );
    await this.log(user, n, t.number, 'CREATE', {});
    return this.shape(n);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateNoCallDto) {
    await this.access.mustKeep(user);
    const n = await this.noCallOf(user, id);
    const t = await this.territoryOf(user, n.territoryId);
    const changed: string[] = [];
    if (dto.address !== undefined && dto.address.trim() !== n.address) {
      const address = dto.address.trim();
      await this.mustBeUnique(t.id, address, n.id);
      n.address = address;
      changed.push('address');
    }
    if (dto.surname !== undefined) {
      const surname = dto.surname.trim() || null;
      if (surname !== n.surname) {
        n.surname = surname;
        changed.push('surname');
      }
    }
    if (dto.notedOn !== undefined && dto.notedOn !== n.notedOn) {
      this.mustNotBeFuture(dto.notedOn, await this.today(user.congregationId));
      n.notedOn = dto.notedOn;
      n.reviewOn = addDays(dto.notedOn, NO_CALL_REVIEW_DAYS);
      changed.push('notedOn');
    }
    if (changed.length === 0) return this.shape(n);
    await this.noCalls.save(n);
    await this.log(user, n, t.number, 'UPDATE', { changed });
    return this.shape(n);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const n = await this.noCallOf(user, id);
    await this.mustDecide(user, n);
    const t = await this.territories.findOne({ where: { id: n.territoryId } });
    await this.noCalls.delete({ id: n.id });
    await this.log(user, n, t?.number ?? '', 'DELETE', {});
    return { ok: true };
  }

  /** «Оставить на 2 года»: the review moves two years from today. */
  async keep(user: AuthenticatedUser, id: string) {
    const n = await this.noCallOf(user, id);
    await this.mustDecide(user, n);
    const t = await this.territories.findOne({ where: { id: n.territoryId } });
    n.reviewOn = addDays(
      await this.today(user.congregationId),
      NO_CALL_REVIEW_DAYS,
    );
    await this.noCalls.save(n);
    await this.log(user, n, t?.number ?? '', 'UPDATE', { kept: true });
    return this.shape(n);
  }

  /** Addresses up for review now or within the month ahead. */
  async review(user: AuthenticatedUser) {
    await this.access.mustSeeAll(user);
    return this.dueOf(
      user.congregationId,
      await this.today(user.congregationId),
    );
  }

  async dueOf(congregationId: string, today: string) {
    const rows = await this.noCalls.find({
      where: {
        congregationId,
        reviewOn: LessThanOrEqual(addDays(today, NO_CALL_REVIEW_AHEAD)),
      },
      order: { reviewOn: 'ASC' },
    });
    if (rows.length === 0) return [];
    const ts = await this.territories.find({ where: { congregationId } });
    const numberOf = new Map(ts.map((t) => [t.id, t.number]));
    return rows.map((n) => ({
      ...this.shape(n),
      territoryId: n.territoryId,
      number: numberOf.get(n.territoryId) ?? '',
    }));
  }

  /**
   * For the home screen: how many addresses wait for this user's review, and
   * the earliest day — or null when none, or when they are not his to review.
   */
  async waitingFor(
    user: AuthenticatedUser,
  ): Promise<{ count: number; first: string } | null> {
    const a = await this.access.of(user);
    if (!a.seesAll || !a.verified) return null;
    const due = await this.dueOf(
      user.congregationId,
      await this.today(user.congregationId),
    );
    if (due.length === 0) return null;
    return { count: due.length, first: due[0].reviewOn };
  }
}
