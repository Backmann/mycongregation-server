import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CartWeek } from '../entities/cart-week.entity';
import { CartSlot } from '../entities/cart-slot.entity';
import { CartRequest } from '../entities/cart-request.entity';
import { CartAssignment } from '../entities/cart-assignment.entity';
import { CartLocation } from '../entities/cart-location.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Gender } from '../common/enums/gender.enum';
import { BuildCartWeekDto } from './dto/build-cart-week.dto';
import { CreateCartRequestDto } from './dto/create-cart-request.dto';
import { CreateCartAssignmentDto } from './dto/create-cart-assignment.dto';
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

export const CART_CAPACITY_MAX = 4;
export const CART_CAPACITY_MIN = 2;

export function computeSlotFlags(genders: (Gender | null)[]): {
  underMin: boolean;
  brotherSister: boolean;
} {
  const count = genders.length;
  const brothers = genders.filter((g) => g === Gender.BROTHER).length;
  const sisters = genders.filter((g) => g === Gender.SISTER).length;
  return {
    underMin: count === 1,
    brotherSister: count === 2 && brothers === 1 && sisters === 1,
  };
}

export interface CartAssignmentView {
  id: string;
  publisherId: string | null;
  name: string;
  gender: string | null;
  external: boolean;
}
export interface CartRequestView {
  publisherId: string;
  name: string;
  withWhomNote: string | null;
}
export interface SlotWarnings {
  underMin: boolean;
  brotherSister: boolean;
  secondShiftSameDay: boolean;
}
export interface CartSlotView {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  locationId: string;
  locationName: string;
  locationKind: string;
  capacityMax: number;
  myRequest: boolean;
  myAssignment?: boolean;
  assignedCount?: number;
  requestCount?: number;
  assignments?: CartAssignmentView[];
  requests?: CartRequestView[];
  warnings?: SlotWarnings;
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
    @InjectRepository(CartAssignment)
    private readonly assignmentsRepo: Repository<CartAssignment>,
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
    // Additive: a pre-existing draft/collecting week is extended with the new
    // days x locations rather than recreated. Window/step are week-level, so a
    // pre-existing week keeps its own; only the first build sets them.
    let week = await this.weeksRepo.findOne({
      where: { congregationId, weekStartDate: dto.weekStartDate },
    });
    if (week && week.status === 'published') {
      throw new BadRequestException('Week is already published');
    }
    if (!week) {
      week = await this.weeksRepo.save(
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
    }
    const gen = generateCartSlots(
      dto.weekStartDate,
      dto.daysOfWeek,
      uniqueLocationIds,
      dto.startTime,
      dto.endTime,
      dto.stepMinutes,
    );
    const existingSlots = await this.slotsRepo.find({
      where: { weekId: week.id },
    });
    const seen = new Set(
      existingSlots.map((s) => `${s.date}|${s.locationId}|${s.startTime}`),
    );
    const toCreate = gen.filter(
      (g) => !seen.has(`${g.date}|${g.locationId}|${g.startTime}`),
    );
    if (toCreate.length > 0) {
      const weekId = week.id;
      await this.slotsRepo.save(
        toCreate.map((g) =>
          this.slotsRepo.create({
            congregationId,
            weekId,
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
    const [requests, assignments] = await Promise.all([
      slotIds.length
        ? this.requestsRepo.find({ where: { slotId: In(slotIds) } })
        : Promise.resolve([] as CartRequest[]),
      slotIds.length
        ? this.assignmentsRepo.find({ where: { slotId: In(slotIds) } })
        : Promise.resolve([] as CartAssignment[]),
    ]);
    const manager = await this.isManager(user);
    const me = await this.myPublisher(congregationId, user.id);
    const myPid = me ? me.id : null;
    const published = week.status === 'published';

    const pubIds = [
      ...new Set([
        ...requests.map((r) => r.publisherId),
        ...assignments
          .map((a) => a.publisherId)
          .filter((x): x is string => !!x),
      ]),
    ];
    const pubs = pubIds.length
      ? await this.publishersRepo.find({
          where: { id: In(pubIds), congregationId },
        })
      : [];
    const pubById = new Map(pubs.map((p) => [p.id, p]));
    const nameOf = (id: string): string => {
      const p = pubById.get(id);
      return p ? `${p.lastName} ${p.firstName}`.trim() : '';
    };

    const reqBySlot = new Map<string, CartRequest[]>();
    const mineReq = new Set<string>();
    for (const r of requests) {
      const arr = reqBySlot.get(r.slotId) ?? [];
      arr.push(r);
      reqBySlot.set(r.slotId, arr);
      if (myPid && r.publisherId === myPid) mineReq.add(r.slotId);
    }
    const asgBySlot = new Map<string, CartAssignment[]>();
    for (const a of assignments) {
      const arr = asgBySlot.get(a.slotId) ?? [];
      arr.push(a);
      asgBySlot.set(a.slotId, arr);
    }
    const slotDate = new Map(slots.map((s) => [s.id, s.date]));
    const dayPub = new Map<string, number>();
    for (const a of assignments) {
      if (a.publisherId) {
        const key = `${a.publisherId}|${slotDate.get(a.slotId)}`;
        dayPub.set(key, (dayPub.get(key) ?? 0) + 1);
      }
    }

    return {
      id: week.id,
      weekStartDate: week.weekStartDate,
      status: week.status,
      startTime: week.startTime,
      endTime: week.endTime,
      stepMinutes: week.stepMinutes,
      slots: slots.map((s) => {
        const asgs = asgBySlot.get(s.id) ?? [];
        const genders: (Gender | null)[] = asgs.map((a) =>
          a.publisherId ? (pubById.get(a.publisherId)?.gender ?? null) : null,
        );
        const assignmentsView: CartAssignmentView[] = asgs.map((a) => ({
          id: a.id,
          publisherId: a.publisherId,
          name: a.publisherId ? nameOf(a.publisherId) : (a.externalName ?? ''),
          gender: a.publisherId
            ? (pubById.get(a.publisherId)?.gender ?? null)
            : null,
          external: !a.publisherId,
        }));
        const base: CartSlotView = {
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          locationId: s.locationId,
          locationName: s.location?.name ?? '',
          locationKind: s.location?.kind ?? 'cart',
          capacityMax: CART_CAPACITY_MAX,
          myRequest: mineReq.has(s.id),
        };
        if (manager) {
          const reqs = reqBySlot.get(s.id) ?? [];
          const flags = computeSlotFlags(genders);
          const secondShiftSameDay = asgs.some(
            (a) =>
              !!a.publisherId &&
              (dayPub.get(`${a.publisherId}|${s.date}`) ?? 0) > 1,
          );
          base.assignedCount = asgs.length;
          base.requestCount = reqs.length;
          base.requests = reqs.map((r) => ({
            publisherId: r.publisherId,
            name: nameOf(r.publisherId),
            withWhomNote: r.withWhomNote,
          }));
          base.assignments = assignmentsView;
          base.myAssignment =
            !!myPid && asgs.some((a) => a.publisherId === myPid);
          base.warnings = {
            underMin: flags.underMin,
            brotherSister: flags.brotherSister,
            secondShiftSameDay,
          };
        } else if (published) {
          base.assignedCount = asgs.length;
          base.assignments = assignmentsView;
          base.myAssignment =
            !!myPid && asgs.some((a) => a.publisherId === myPid);
        }
        return base;
      }),
    };
  }

  async assignToSlot(
    congregationId: string,
    slotId: string,
    user: AuthenticatedUser,
    dto: CreateCartAssignmentDto,
  ): Promise<CartAssignment> {
    const hasPub = !!dto.publisherId;
    const hasExt = !!dto.externalName && dto.externalName.trim().length > 0;
    if (hasPub === hasExt) {
      throw new BadRequestException(
        'Provide exactly one of publisherId or externalName',
      );
    }
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, congregationId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    const week = await this.weeksRepo.findOne({ where: { id: slot.weekId } });
    if (!week || week.status === 'draft') {
      throw new BadRequestException('Week is not open for assignment');
    }
    const current = await this.assignmentsRepo.count({ where: { slotId } });
    if (current >= CART_CAPACITY_MAX) {
      throw new BadRequestException('Slot is full');
    }
    if (hasPub) {
      const pub = await this.publishersRepo.findOne({
        where: { id: dto.publisherId, congregationId },
      });
      if (!pub) throw new BadRequestException('Unknown publisher');
      const existing = await this.assignmentsRepo.findOne({
        where: { slotId, publisherId: dto.publisherId },
      });
      if (existing) throw new BadRequestException('Already assigned');
    }
    return this.assignmentsRepo.save(
      this.assignmentsRepo.create({
        congregationId,
        slotId,
        publisherId: hasPub ? dto.publisherId! : null,
        externalName: hasPub ? null : dto.externalName!.trim(),
        createdById: user.id,
      }),
    );
  }

  async removeAssignment(
    congregationId: string,
    slotId: string,
    assignmentId: string,
  ): Promise<void> {
    const asg = await this.assignmentsRepo.findOne({
      where: { id: assignmentId, slotId, congregationId },
    });
    if (!asg) throw new NotFoundException('Assignment not found');
    await this.assignmentsRepo.remove(asg);
  }

  async publishWeek(congregationId: string, id: string): Promise<CartWeek> {
    const week = await this.weeksRepo.findOne({
      where: { id, congregationId },
    });
    if (!week) throw new NotFoundException('Week not found');
    if (week.status !== 'collecting') {
      throw new BadRequestException('Week is not in the collecting state');
    }
    week.status = 'published';
    return this.weeksRepo.save(week);
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
