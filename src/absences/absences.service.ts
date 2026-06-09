import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Absence } from '../entities/absence.entity';
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
  ) {}

  private baseQuery(tenantId: string) {
    // leftJoin (not AndSelect) + explicit addSelect keeps encrypted publisher
    // columns out of the query while still hydrating a light publisher object.
    return this.repo
      .createQueryBuilder('a')
      .leftJoin('a.publisher', 'p')
      .addSelect(['p.id', 'p.displayName', 'p.firstName', 'p.lastName'])
      .where('a.congregation_id = :tenantId', { tenantId });
  }

  async findAll(tenantId: string, query: QueryAbsencesDto): Promise<Absence[]> {
    const qb = this.baseQuery(tenantId);

    if (query.publisherId) {
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

  async findOne(tenantId: string, id: string): Promise<Absence> {
    const found = await this.baseQuery(tenantId)
      .andWhere('a.id = :id', { id })
      .withDeleted()
      .getOne();
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    return found;
  }

  async create(tenantId: string, dto: CreateAbsenceDto): Promise<Absence> {
    const entity = this.repo.create({ ...dto, congregationId: tenantId });
    return this.repo.save(entity);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateAbsenceDto,
  ): Promise<Absence> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    Object.assign(found, dto);
    return this.repo.save(found);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    await this.repo.softDelete(id);
  }

  async restore(tenantId: string, id: string): Promise<Absence> {
    const found = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      withDeleted: true,
    });
    if (!found) {
      throw new NotFoundException('Absence not found');
    }
    await this.repo.restore(id);
    return this.findOne(tenantId, id);
  }
}
