import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hall } from '../entities/hall.entity';
import { CreateHallDto } from './dto/create-hall.dto';
import { UpdateHallDto } from './dto/update-hall.dto';

@Injectable()
export class HallsService {
  constructor(
    @InjectRepository(Hall)
    private readonly repo: Repository<Hall>,
  ) {}

  /** Default hall first, then alphabetically. */
  async list(congregationId: string): Promise<Hall[]> {
    return this.repo.find({
      where: { congregationId },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async getById(congregationId: string, id: string): Promise<Hall> {
    const hall = await this.repo.findOne({ where: { id, congregationId } });
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    return hall;
  }

  /** The very first hall of a congregation becomes the default automatically. */
  async create(congregationId: string, dto: CreateHallDto): Promise<Hall> {
    const existing = await this.repo.count({ where: { congregationId } });
    const makeDefault = dto.isDefault === true || existing === 0;
    if (makeDefault && existing > 0) {
      await this.repo.update({ congregationId }, { isDefault: false });
    }
    const hall = this.repo.create({
      congregationId,
      name: dto.name.trim(),
      address: dto.address.trim(),
      isDefault: makeDefault,
    });
    return this.repo.save(hall);
  }

  async update(
    congregationId: string,
    id: string,
    dto: UpdateHallDto,
  ): Promise<Hall> {
    const hall = await this.getById(congregationId, id);
    if (dto.isDefault === true) {
      // Single default per congregation: clear the flag everywhere first.
      await this.repo.update({ congregationId }, { isDefault: false });
    }
    if (dto.name !== undefined) hall.name = dto.name.trim();
    if (dto.address !== undefined) hall.address = dto.address.trim();
    if (dto.isDefault !== undefined) hall.isDefault = dto.isDefault;
    return this.repo.save(hall);
  }

  async remove(congregationId: string, id: string): Promise<void> {
    const hall = await this.getById(congregationId, id);
    await this.repo.remove(hall);
  }
}
