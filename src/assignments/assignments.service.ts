import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, IsNull, Not, In } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AssignmentsService {
  constructor(
    @InjectRepository(Assignment)
    private readonly repo: Repository<Assignment>,
  ) {}

  async list(
    congregationId: string,
    query: QueryAssignmentDto,
  ): Promise<PaginatedResult<Assignment>> {
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.congregationId = :congregationId', { congregationId });

    if (query.weekStart) {
      qb.andWhere('a.weekStartDate >= :weekStart', {
        weekStart: query.weekStart,
      });
    }
    if (query.weekEnd) {
      qb.andWhere('a.weekStartDate < :weekEnd', { weekEnd: query.weekEnd });
    }
    if (query.eventType) {
      qb.andWhere('a.eventType = :eventType', { eventType: query.eventType });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    if (query.publisherId) {
      qb.andWhere(
        '(a.publisherId = :publisherId OR a.assistantPublisherId = :publisherId)',
        { publisherId: query.publisherId },
      );
    }
    if (query.partKey) {
      qb.andWhere('a.partKey = :partKey', { partKey: query.partKey });
    }

    if (query.includeRemoved) {
      qb.withDeleted();
    }

    qb.orderBy('a.weekStartDate', 'ASC')
      .addOrderBy('a.eventType', 'ASC')
      .addOrderBy('a.partOrder', 'ASC')
      .addOrderBy('a.partKey', 'ASC')
      .skip(offset)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

  async getById(congregationId: string, id: string): Promise<Assignment> {
    const assignment = await this.repo.findOne({
      where: { id, congregationId },
      withDeleted: true,
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return assignment;
  }

  async create(
    congregationId: string,
    dto: CreateAssignmentDto,
  ): Promise<Assignment> {
    const assignment = this.repo.create({
      ...dto,
      congregationId,
    });
    return this.repo.save(assignment);
  }

  async bulkCreate(
    congregationId: string,
    dtos: CreateAssignmentDto[],
  ): Promise<Assignment[]> {
    const entities = dtos.map((dto) =>
      this.repo.create({ ...dto, congregationId }),
    );
    return this.repo.save(entities);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateAssignmentDto,
  ): Promise<Assignment> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      throw new NotFoundException(
        `Assignment ${id} is removed; restore it before updating`,
      );
    }
    Object.assign(existing, dto);
    return this.repo.save(existing);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const existing = await this.getById(congregationId, id);
    if (existing.deletedAt) {
      return;
    }
    await this.repo.softDelete({
      id,
      congregationId,
    });
  }

  async restore(congregationId: string, id: string): Promise<Assignment> {
    const existing = await this.repo.findOne({
      where: {
        id,
        congregationId,
        deletedAt: Not(IsNull()),
      },
      withDeleted: true,
    });
    if (!existing) {
      throw new NotFoundException(`Removed assignment ${id} not found`);
    }
    await this.repo.restore({
      id,
      congregationId,
    });
    return this.getById(congregationId, id);
  }
}
