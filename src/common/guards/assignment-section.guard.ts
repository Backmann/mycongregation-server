import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Assignment } from '../../entities/assignment.entity';
import { Responsibility } from '../../entities/responsibility.entity';
import { EventType } from '../enums/event-type.enum';
import { ResponsibilityType } from '../enums/responsibility-type.enum';
import { UserRole } from '../enums/user-role.enum';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { refusal } from '../../common/errors/refusal';

/**
 * Maps a schedule section (assignment event type) to the responsibilities that
 * may edit it. Holding ANY one of a section's responsibilities is enough.
 * See docs/architecture/roles-and-permissions.md.
 *
 *   midweek           -> Руководитель встречи «Жизнь и служение»
 *   weekend           -> Координатор совета старейшин (weekend in this cong.)
 *   memorial          -> Координатор совета старейшин: the Memorial programme
 *                        is settled by the body together, not by one appointed
 *                        brother, so it follows the weekend meeting rather
 *                        than gaining a responsibility of its own
 *   cleaning          -> Координатор уборки
 *   av_duty           -> Координатор обязанностей ИЛИ координатор совета
 *                        старейшин (совет старейшин тоже правит обязанности)
 *   public_witnessing -> Публичное свидетельствование
 */
export const EVENT_TYPE_RESPONSIBILITY: Record<
  EventType,
  ResponsibilityType[]
> = {
  [EventType.MIDWEEK]: [ResponsibilityType.LIFE_MINISTRY_OVERSEER],
  // His assistant stands in for him (Lionel, 21 November 2026): with the
  // coordinator away, the weekend and the Memorial must not wait.
  [EventType.WEEKEND]: [
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
  ],
  [EventType.MEMORIAL]: [
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
  ],
  [EventType.CLEANING]: [ResponsibilityType.CLEANING_COORDINATOR],
  [EventType.AV_DUTY]: [
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  ],
  [EventType.PUBLIC_WITNESSING]: [ResponsibilityType.PUBLIC_WITNESSING],
};

/**
 * May this person write the given meetings? The same rule as the guard below,
 * for a write that finds out its meetings only from what it carries — a
 * workbook writes the midweek, a Watchtower the weekend (rights review,
 * 21 November 2026: any elder loaded both and so wrote programmes he could
 * not edit by hand).
 */
export async function assertMayWriteSections(
  responsibilities: Repository<Responsibility>,
  user: AuthenticatedUser,
  eventTypes: EventType[],
): Promise<void> {
  if (user.role === UserRole.ADMIN) return;
  const held = new Set(
    (
      await responsibilities.find({
        where: { congregationId: user.congregationId, userId: user.id },
        select: ['type'],
      })
    ).map((r) => r.type),
  );
  for (const eventType of new Set(eventTypes)) {
    const allowed = EVENT_TYPE_RESPONSIBILITY[eventType] ?? [];
    if (!allowed.some((t) => held.has(t)))
      throw new ForbiddenException(
        refusal(
          'NEEDS_RESPONSIBILITY',
          `Requires one of [${allowed.join(', ')}] for section ${eventType}`,
          { responsibilities: allowed },
        ),
      );
  }
}

/**
 * Section-scoped authorization for schedule (assignment) writes.
 *
 * Semantics mirror ResponsibilityGuard ("admin OR holds responsibility"), but
 * the required responsibility is derived from the *section* the write targets,
 * not from static route metadata — because one endpoint serves both the
 * midweek and the weekend program:
 *
 *   - admin role                                   -> allow
 *   - holds ANY of the section's responsibilities  -> allow
 *   - otherwise                                    -> 403
 *
 * For a bulk write spanning several sections, the caller must satisfy EACH
 * section (hold at least one allowed responsibility per section).
 *
 * The section (event type) is read from the request body on create / bulk
 * (eventType is required on CreateAssignmentDto) and from the stored record on
 * :id routes (update / remove / restore).
 */
@Injectable()
export class AssignmentSectionGuard implements CanActivate {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params?: { id?: string };
      body?: unknown;
    }>();

    const user = request.user;
    if (!user) {
      throw new ForbiddenException('No user context');
    }
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const eventTypes = await this.resolveEventTypes(
      request,
      user.congregationId,
    );

    if (eventTypes.length === 0) {
      throw new ForbiddenException('Cannot determine schedule section');
    }

    // Collect every responsibility that could satisfy any targeted section,
    // so we can resolve what the caller holds in a single query.
    const candidates = new Set<ResponsibilityType>();
    for (const eventType of eventTypes) {
      const allowed = EVENT_TYPE_RESPONSIBILITY[eventType];
      if (!allowed || allowed.length === 0) {
        throw new ForbiddenException(
          refusal(
            'NEEDS_ROLE',
            `Section ${eventType} is restricted to admins`,
            { roles: ['admin'] },
          ),
        );
      }
      allowed.forEach((t) => candidates.add(t));
    }

    const held = await this.responsibilitiesRepo.find({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([...candidates]),
      },
      select: ['type'],
    });
    const heldTypes = new Set(held.map((r) => r.type));

    // Each targeted section must be satisfied by at least one held
    // responsibility allowed for that section.
    for (const eventType of eventTypes) {
      const allowed = EVENT_TYPE_RESPONSIBILITY[eventType];
      const satisfied = allowed.some((t) => heldTypes.has(t));
      if (!satisfied) {
        throw new ForbiddenException(
          refusal(
            'NEEDS_RESPONSIBILITY',
            `Requires one of [${allowed.join(', ')}] for section ${eventType}`,
            { responsibilities: allowed },
          ),
        );
      }
    }
    return true;
  }

  /** Resolve the section(s) this request targets. */
  private async resolveEventTypes(
    request: { params?: { id?: string }; body?: unknown },
    congregationId: string,
  ): Promise<EventType[]> {
    const id = request.params?.id;
    if (id) {
      const record = await this.assignmentsRepo.findOne({
        where: { id, congregationId },
        withDeleted: true,
        select: ['id', 'eventType'],
      });
      if (!record) {
        throw new NotFoundException('Assignment not found');
      }
      // A row moved to another meeting (PATCH with eventType) needs the
      // right to the meeting it goes to as well: the midweek overseer put
      // a part into the weekend, the coordinator the other way round
      // (rights review, 21 November 2026).
      const to = (request.body as { eventType?: EventType } | undefined)
        ?.eventType;
      return to && to !== record.eventType
        ? [record.eventType, to]
        : [record.eventType];
    }

    const body = request.body as
      | {
          eventType?: EventType;
          assignments?: Array<{ eventType?: EventType }>;
        }
      | undefined;

    if (body && Array.isArray(body.assignments)) {
      return body.assignments
        .map((a) => a.eventType)
        .filter((eventType): eventType is EventType => !!eventType);
    }
    if (body?.eventType) {
      return [body.eventType];
    }
    return [];
  }
}
