import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CartWeek } from '../entities/cart-week.entity';
import { CartSlot } from '../entities/cart-slot.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { BuildCartWeekDto } from './dto/build-cart-week.dto';
import { CreateCartRequestDto } from './dto/create-cart-request.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(
    min % 60,
  ).padStart(2, '0')}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface GeneratedSlot {
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
}

/**
 * Pure slot generation: for each chosen day and location, emit full-step slots
 * within [startTime, endTime); any trailing remainder shorter than one step is
 * dropped. Exported for direct unit testing.
 */
export function generateCartSlots(
  weekStartDate: string,
  daysOfWeek: number[],
  locationIds: string[],
  startTime: string,
  endTime: string,
  stepMinutes: number,
): GeneratedSlot[] {
  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  const out: GeneratedSlot[] = [];
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  for (const dow of days) {
    const date = addDays(weekStartDate, dow - 1);
    for (let t = startMin; t + stepMinutes <= endMin; t += stepMinutes) {
      for (const locationId of locationIds) {
        out.push({
          date,
          startTime: toHHMM(t),
          endTime: toHHMM(t + stepMinutes),
          locationId,
        });
      }
    }
  }
  return out;
}

export interface CartSlotView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
  locationName: string;
  locationKind: string;
  myRequest: boolean;
  requestCount?: number;
}
export interface CartWeekView {
  id: string;
  weekStartDate: string;
  status: string;
  startTime: string;
  endTime: string;
  stepMinutes: number;
  slots: CartSlotView[];
}

@Injectable()
export class CartWeeksService {
  constructor(
    @InjectRepository(CartWeek)
    private readonly weeksRepo: Repository<CartWeek>,
    @InjectRepository(CartSlot)
    private readonly slotsRepo: Repository<CartSlot>,
    @InjectRepository(CartRequest)
    private readonly requestsRepo: Repository<CartRequest>,
    @InjectRepository(CartLocation)
    private readonly locationsRepo: Repository<CartLocation>,
    @InjectRepository(Publisher)
    private readonly publishersRepo: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  async buildWeek(
    congregationId: string,
    userId: string,
    dto: BuildCartWeekDto,
  ): Promise<CartWeek> {
    const startMin = toMin(dto.startTime);
    const endMin = toMin(dto.endTime);
    if (endMin - startMin < dto.stepMinutes) {
      throw new BadRequestException('Window is smaller than one step');
    }
    const uniqueLocationIds = [...new Set(dto.locationIds)];
    const locations = await this.locationsRepo.find({
      where: { id: In(uniqueLocationIds), congregationId },
    });
    if (locations.length !== uniqueLocationIds.length) {
      throw new BadRequestException('Unknown location');
    }
    const existing = await this.weeksRepo.findOne({
      where: { congregationId, weekStartDate: dto.weekStartDate },
    });
    if (existing) {
      throw new ConflictException('A week already exists for this date');
    }
    const week = await this.weeksRepo.save(
      this.weeksRepo.create({
        congregationId,
        weekStartDate: dto.weekStartDate,
        status: 'draft',
        startTime: dto.startTime,
        endTime: dto.endTime,
        stepMinutes: dto.stepMinutes,
        createdById: userId,
      }),
    );
    const gen = generateCartSlots(
      dto.weekStartDate,
      dto.daysOfWeek,
      uniqueLocationIds,
      dto.startTime,
      dto.endTime,
      dto.stepMinutes,
    );
    if (gen.length > 0) {
      await this.slotsRepo.save(
        gen.map((g) =>
          this.slotsRepo.create({
            congregationId,
            weekId: week.id,
            date: g.date,
            startTime: g.startTime,
            endTime: g.endTime,
            locationId: g.locationId,
          }),
        ),
      );
    }
    return week;
  }

  async openWeek(congregationId: string, id: string): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status !== 'draft') {
      throw new BadRequestException('Only a draft week can be opened');
    }
    week.status = 'collecting';
    return this.weeksRepo.save(week);
  }

  async deleteWeek(congregationId: string, id: string): Promise<void> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    await this.weeksRepo.remove(week);
  }

  private async isManager(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([
          ResponsibilityType.PUBLIC_WITNESSING,
          ResponsibilityType.SERVICE_OVERSEER,
        ]),
      },
    });
    return held > 0;
  }

  private async myPublisher(
    congregationId: string,
    userId: string,
  ): Promise<Publisher | null> {
    return this.publishersRepo.findOne({ where: { congregationId, userId } });
  }

  async getWeek(
    congregationId: string,
    weekStart: string,
    user: AuthenticatedUser,
  ): Promise<CartWeekView | null> {
    const week = await this.weeksRepo.findOne({
      where: { congregationId, weekStartDate: weekStart },
    });
    if (!week) return null;
    const slots = await this.slotsRepo.find({
      where: { weekId: week.id, congregationId },
      relations: { location: true },
      order: { date: 'ASC', startTime: 'ASC' },
    });
    const slotIds = slots.map((s) => s.id);
    const requests = slotIds.length
      ? await this.requestsRepo.find({ where: { slotId: In(slotIds) } })
      : [];
    const manager = await this.isManager(user);
    const me = await this.myPublisher(congregationId, user.id);
    const myPid = me ? me.id : null;
    const countBySlot = new Map<string, number>();
    const mineSet = new Set<string>();
    for (const r of requests) {
      countBySlot.set(r.slotId, (countBySlot.get(r.slotId) ?? 0) + 1);
      if (myPid && r.publisherId === myPid) mineSet.add(r.slotId);
    }
    return {
      id: week.id,
      weekStartDate: week.weekStartDate,
      status: week.status,
      startTime: week.startTime,
      endTime: week.endTime,
      stepMinutes: week.stepMinutes,
      slots: slots.map((s) => ({
        id: s.id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        locationId: s.locationId,
        locationName: s.location?.name ?? '',
        locationKind: s.location?.kind ?? 'cart',
        myRequest: mineSet.has(s.id),
        ...(manager ? { requestCount: countBySlot.get(s.id) ?? 0 } : {}),
      })),
    };
  }

  async applyToSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
    dto: CreateCartRequestDto,
  ): Promise<CartRequest> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me) throw new ForbiddenException('No publisher profile');
    if (!me.capabilities || me.capabilities['public_witnessing'] !== true) {
      throw new ForbiddenException('Not eligible for cart witnessing');
    }
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
      relations: { week: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.week || slot.week.status !== 'collecting') {
      throw new BadRequestException('Week is not collecting requests');
    }
    const existing = await this.requestsRepo.findOne({
      where: { slotId, publisherId: me.id },
    });
    if (existing) {
      existing.withWhomNote = dto.withWhomNote ?? null;
      return this.requestsRepo.save(existing);
    }
    return this.requestsRepo.save(
      this.requestsRepo.create({
        congregationId,
        slotId,
        publisherId: me.id,
        withWhomNote: dto.withWhomNote ?? null,
      }),
    );
  }

  async withdrawFromSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const me = await this.myPublisher(congregationId, user.id);
    if (!me) throw new ForbiddenException('No publisher profile');
    await this.requestsRepo.delete({
      slotId,
      publisherId: me.id,
      congregationId,
    });
  }
}
