import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Absence } from '../entities/absence.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateAbsenceDto } from './dto/create-absence.dto';
import { UpdateAbsenceDto } from './dto/update-absence.dto';
import { QueryAbsencesDto } from './dto/query-absences.dto';

/** Today's date (YYYY-MM-DD) in the congregation's timezone. */
function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
}

@Injectable()
export class AbsencesService {
  constructor(
    @InjectRepository(Absence)
    private readonly repo: Repository<Absence>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  /** Responsibilities that may manage ANY publisher's absences. */
  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.SECRETARY,
  ];

  /** True when the user may manage absences for anyone (admin or held). */
  private async isManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(AbsencesService.MANAGER_RESPONSIBILITIES),
      },
    });
    return held > 0;
  }

  /**
   * Authorize a write. Managers may write any publisher's absence; anyone
   * else may only write their OWN (the publisher linked to their user).
   */
  private async assertCanWrite(
    user: AuthenticatedUser,
    targetPublisherId: string,
  ): Promise<void> {
    if (await this.isManager(user)) return;
    const mine = await this.publishersRepo.findOne({
      where: { congregationId: user.congregationId, userId: user.id },
    });
    if (!mine || mine.id !== targetPublisherId) {
      throw new ForbiddenException('You may only manage your own absences');
    }
  }

  private baseQuery(tenantId: string) {
    // leftJoin (not AndSelect) + explicit addSelect keeps encrypted publisher
    // columns out of the query while still hydrating a light publisher object.
    return this.repo
      .createQueryBuilder('a')
      .leftJoin('a.publisher', 'p')
      .addSelect(['p.id', 'p.displayName', 'p.firstName', 'p.lastName'])
      .where('a.congregation_id = :tenantId', { tenantId });
  }

  /**
   * Absence READS are scoped: admins, elders, and holders of any
   * responsibility (planners of schedules/duties/cleaning legitimately need
   * the full picture) see everything; a regular publisher sees only their
   * OWN absences. Personal notes must not leak congregation-wide.
   */
  private async canReadAll(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) {
      return true;
    }
    const held = await this.responsibilitiesRepo.count({
      where: { congregationId: user.congregationId, userId: user.id },
    });
    return held > 0;
  }

  private async ownPublisherId(
    user: AuthenticatedUser,
  ): Promise<string | null> {
    const me = await this.publishersRepo.findOne({
      where: { congregationId: user.congregationId, userId: user.id },
    });
    return me?.id ?? null;
  }

  async findAll(
    tenantId: string,
    query: QueryAbsencesDto,
    user: AuthenticatedUser,
  ): Promise<Absence[]> {
    const qb = this.baseQuery(tenantId);

    if (!(await this.canReadAll(user))) {
      const myId = await this.ownPublisherId(user);
      if (!myId) return [];
      qb.andWhere('a.publisher_id = :own', { own: myId });
    } else if (query.publisherId) {
      qb.andWhere('a.publisher_id = :pid', { pid: query.publisherId });
    }
    if (query.all !== 'true') {
      qb.andWhere('COALESCE(a.end_date, a.start_date) >= :today', {
        today: berlinToday(),
      });
    }
    if (query.includeRemoved === 'true') {
      qb.withDeleted();
    }

    return qb.orderBy('a.start_date', 'ASC').getMany();
  }

  async findOne(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<Absence> {
    const found = await this.baseQuery(tenantId)
      .andWhere('a.id = :id', { id })
      .withDeleted()
      .getOne();
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    if (!(await this.canReadAll(user))) {
      const myId = await this.ownPublisherId(user);
      if (!myId || found.publisherId !== myId) {
        throw new ForbiddenException('You may only view your own absences');
      }
    }
    return found;
  }

  async create(
    tenantId: string,
    dto: CreateAbsenceDto,
    user: AuthenticatedUser,
  ): Promise<Absence> {
    await this.assertCanWrite(user, dto.publisherId);
    const entity = this.repo.create({ ...dto, congregationId: tenantId });
    return this.repo.save(entity);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateAbsenceDto,
    user: AuthenticatedUser,
  ): Promise<Absence> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    // Ownership is checked against the STORED publisher, not the DTO.
    await this.assertCanWrite(user, found.publisherId);
    // A non-manager may not reassign the absence to another publisher.
    if (dto.publisherId && dto.publisherId !== found.publisherId) {
      await this.assertCanWrite(user, dto.publisherId);
    }
    Object.assign(found, dto);
    return this.repo.save(found);
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    await this.assertCanWrite(user, found.publisherId);
    await this.repo.softDelete(id);
  }

  async restore(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<Absence> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    await this.assertCanWrite(user, found.publisherId);
    await this.repo.restore(id);
    return this.findOne(tenantId, id, user);
  }
}
