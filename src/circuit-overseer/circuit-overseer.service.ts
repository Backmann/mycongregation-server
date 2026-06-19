import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CircuitOverseer } from '../entities/circuit-overseer.entity';
import { UpsertCircuitOverseerDto } from './dto/upsert-circuit-overseer.dto';

@Injectable()
export class CircuitOverseerService {
  constructor(
    @InjectRepository(CircuitOverseer)
    private readonly repo: Repository<CircuitOverseer>,
  ) {}

  /** The congregation's current circuit overseer, or null if none set. */
  async get(tenantId: string): Promise<CircuitOverseer | null> {
    return this.repo.findOne({ where: { congregationId: tenantId } });
  }

  /** Create or update the single circuit-overseer record for the congregation. */
  async upsert(
    tenantId: string,
    dto: UpsertCircuitOverseerDto,
  ): Promise<CircuitOverseer> {
    const existing = await this.repo.findOne({
      where: { congregationId: tenantId },
    });
    if (existing) {
      existing.firstName = dto.firstName;
      existing.lastName = dto.lastName;
      existing.wifeName = dto.wifeName ?? null;
      return this.repo.save(existing);
    }
    const created = this.repo.create({
      congregationId: tenantId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      wifeName: dto.wifeName ?? null,
    });
    return this.repo.save(created);
  }
}
