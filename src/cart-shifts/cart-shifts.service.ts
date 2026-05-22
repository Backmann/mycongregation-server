import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
  FindOptionsWhere,
} from 'typeorm';
import { CartShift } from '../entities/cart-shift.entity';
import { CartShiftParticipant } from '../entities/cart-shift-participant.entity';
import { CreateCartShiftDto } from './dto/create-cart-shift.dto';
import { UpdateCartShiftDto } from './dto/update-cart-shift.dto';
import { QueryCartShiftsDto } from './dto/query-cart-shifts.dto';

/** Hard upper bound — a cart shift can never have more than 4 publishers. */
export const CART_MAX_PARTICIPANTS = 4;

@Injectable()
export class CartShiftsService {
  constructor(
    @InjectRepository(CartShift)
    private readonly shifts: Repository<CartShift>,
    @InjectRepository(CartShiftParticipant)
    private readonly participants: Repository<CartShiftParticipant>,
  ) {}

  async listShifts(
    congregationId: string,
    query: QueryCartShiftsDto = {},
  ): Promise<CartShift[]> {
    const where: FindOptionsWhere<CartShift> = { congregationId };
    const { from, to } = query;
    if (from && to) where.date = Between(from, to);
    else if (from) where.date = MoreThanOrEqual(from);
    else if (to) where.date = LessThanOrEqual(to);

    return this.shifts.find({
      where,
      relations: { participants: true },
      order: { date: 'ASC', startTime: 'ASC', createdAt: 'ASC' },
    });
  }

  private async getOwned(
    congregationId: string,
    id: string,
  ): Promise<CartShift> {
    const shift = await this.shifts.findOne({
      where: { id, congregationId },
      relations: { participants: true },
    });
    if (!shift) throw new NotFoundException('Cart shift not found');
    return shift;
  }

  async createShift(
    congregationId: string,
    dto: CreateCartShiftDto,
  ): Promise<CartShift> {
    const shift = this.shifts.create({ ...dto, congregationId });
    const saved = await this.shifts.save(shift);
    return this.getOwned(congregationId, saved.id);
  }

  async updateShift(
    congregationId: string,
    id: string,
    dto: UpdateCartShiftDto,
  ): Promise<CartShift> {
    const shift = await this.getOwned(congregationId, id);
    if (dto.date !== undefined) shift.date = dto.date;
    if (dto.startTime !== undefined) shift.startTime = dto.startTime;
    if (dto.endTime !== undefined) shift.endTime = dto.endTime;
    if (dto.location !== undefined) shift.location = dto.location;
    await this.shifts.save(shift);
    return this.getOwned(congregationId, id);
  }

  async removeShift(congregationId: string, id: string): Promise<void> {
    const shift = await this.getOwned(congregationId, id);
    await this.shifts.remove(shift); // participants cascade
  }

  async addParticipant(
    congregationId: string,
    shiftId: string,
    publisherId: string,
  ): Promise<CartShift> {
    const shift = await this.getOwned(congregationId, shiftId);
    const existing = shift.participants ?? [];
    // Idempotent: already on this shift -> no-op.
    if (existing.some((p) => p.publisherId === publisherId)) return shift;
    // Hard cap.
    if (existing.length >= CART_MAX_PARTICIPANTS) {
      throw new BadRequestException(
        `A cart shift can have at most ${CART_MAX_PARTICIPANTS} publishers`,
      );
    }
    await this.participants.save(
      this.participants.create({ cartShiftId: shiftId, publisherId }),
    );
    return this.getOwned(congregationId, shiftId);
  }

  async removeParticipant(
    congregationId: string,
    shiftId: string,
    publisherId: string,
  ): Promise<CartShift> {
    await this.getOwned(congregationId, shiftId); // tenant check
    await this.participants.delete({ cartShiftId: shiftId, publisherId });
    return this.getOwned(congregationId, shiftId);
  }
}
