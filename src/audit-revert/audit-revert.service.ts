import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AssignmentsService } from '../assignments/assignments.service';
import { LocalNeedsService } from '../local-needs/local-needs.service';
import { AbsencesService } from '../absences/absences.service';
import { HallsService } from '../halls/halls.service';
import { PublishersService } from '../publishers/publishers.service';
import { ServiceGroupsService } from '../service-groups/service-groups.service';
import { CartLocationsService } from '../cart-locations/cart-locations.service';
import { CircuitOverseerService } from '../circuit-overseer/circuit-overseer.service';
import { ExternalCongregationsService } from '../external-congregations/external-congregations.service';
import { SpecialEventsService } from '../special-events/special-events.service';
import { PioneerSchoolService } from '../pioneer-school/pioneer-school.service';
import { CoVisitItemsService } from '../co-visit-items/co-visit-items.service';
import { REVERTABLE_FIELDS } from './revertable';

/**
 * Putting a change back the way it was.
 *
 * The journal has always held BOTH sides of every edit — what a field was and
 * what it became — and nobody ever read the first half back. This is that
 * half, and three rules hold it together:
 *
 *   1. A revert is an ORDINARY EDIT. It goes through the same service method a
 *      person's own change would, so every rule still applies: a frozen past
 *      week stays frozen, a closed report month stays closed, a right the
 *      caller does not have is still refused. It never writes to a table
 *      directly — that would turn the journal into a way around the app.
 *   2. The revert is ITSELF journalled, because it is an ordinary edit. History
 *      can be continued, never rewritten; an undo that left no trace would be
 *      the one action in the app able to erase its own footprint.
 *   3. Only fields on the ALLOWLIST come back. The journal stores whatever the
 *      service wrote, and a DTO is normally filtered by the validation pipe —
 *      calling a service straight from here skips that filter, so the filter
 *      has to live here instead.
 *
 * Entity types not listed are refused outright rather than half-handled.
 * Reports and pioneer records are regulated documents; users hold roles and
 * passwords; attendance is a number somebody counted. For those the journal
 * stays what it was — a record to read, and to retype from by hand if need be.
 */
@Injectable()
export class AuditRevertService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly logRepo: Repository<AuditLog>,
    private readonly assignments: AssignmentsService,
    private readonly localNeeds: LocalNeedsService,
    private readonly absences: AbsencesService,
    private readonly halls: HallsService,
    private readonly publishers: PublishersService,
    private readonly serviceGroups: ServiceGroupsService,
    private readonly cartLocations: CartLocationsService,
    private readonly circuitOverseer: CircuitOverseerService,
    private readonly externalCongregations: ExternalCongregationsService,
    private readonly specialEvents: SpecialEventsService,
    private readonly pioneerSchool: PioneerSchoolService,
    private readonly coVisitItems: CoVisitItemsService,
  ) {}

  /**
   * What each kind of record allows back, and how it is applied.
   *
   * The field lists are deliberately short: a field is here because putting an
   * old value back into it is meaningful on its own. Identity, ownership and
   * anything a second table depends on are left out.
   */
  private readonly revertable: Record<
    string,
    {
      fields: string[];
      apply: (
        tenantId: string,
        id: string,
        dto: Record<string, unknown>,
        user: AuthenticatedUser,
      ) => Promise<unknown>;
    }
  > = {
    assignment: {
      fields: REVERTABLE_FIELDS.assignment,
      apply: (tenantId, id, dto) => this.assignments.update(tenantId, id, dto),
    },
    local_need: {
      fields: REVERTABLE_FIELDS.local_need,
      apply: (tenantId, id, dto, user) =>
        this.localNeeds.update(tenantId, id, dto, user),
    },
    absence: {
      fields: REVERTABLE_FIELDS.absence,
      apply: (tenantId, id, dto, user) =>
        this.absences.update(tenantId, id, dto, user),
    },
    hall: {
      fields: REVERTABLE_FIELDS.hall,
      apply: (tenantId, id, dto) => this.halls.update(tenantId, id, dto),
    },
    publisher: {
      // Name, place in the congregation and the dates that describe service.
      // NOT the status: it is computed from reports, and a hand-set value has
      // its own override switch which this must not impersonate.
      fields: REVERTABLE_FIELDS.publisher,
      apply: (tenantId, id, dto, user) =>
        this.publishers.update(tenantId, id, dto, user.id),
    },
    service_group: {
      fields: REVERTABLE_FIELDS.service_group,
      apply: (tenantId, id, dto) =>
        this.serviceGroups.update(tenantId, id, dto),
    },
    cart_location: {
      fields: REVERTABLE_FIELDS.cart_location,
      apply: (tenantId, id, dto) =>
        this.cartLocations.update(tenantId, id, dto),
    },
    circuit_overseer: {
      fields: REVERTABLE_FIELDS.circuit_overseer,
      apply: (tenantId, id, dto) =>
        this.circuitOverseer.update(tenantId, id, dto),
    },
    external_congregation: {
      fields: REVERTABLE_FIELDS.external_congregation,
      apply: (tenantId, id, dto, user) =>
        this.externalCongregations.update(tenantId, id, dto, user),
    },
    special_event: {
      fields: REVERTABLE_FIELDS.special_event,
      apply: (tenantId, id, dto) =>
        this.specialEvents.update(tenantId, id, dto),
    },
    pioneer_school: {
      fields: REVERTABLE_FIELDS.pioneer_school,
      apply: (tenantId, id, dto, user) =>
        this.pioneerSchool.update(tenantId, id, dto, user),
    },
    co_visit_item: {
      fields: REVERTABLE_FIELDS.co_visit_item,
      apply: (tenantId, id, dto, user) =>
        this.coVisitItems.update(tenantId, id, dto, user),
    },
  };

  /** Elders and administrators; the service behind each field checks the rest. */
  private assertMayAsk(user: AuthenticatedUser): void {
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) return;
    throw new BadRequestException('Not allowed');
  }

  private async entry(tenantId: string, id: string): Promise<AuditLog> {
    const found = await this.logRepo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!found) throw new NotFoundException('Journal entry not found');
    return found;
  }

  /**
   * What a revert would do — asked before it is done.
   *
   * `changedAfter` is the part worth pausing over: somebody may have edited
   * the same record since, and putting an old value back would quietly undo
   * their work too. The app says so; it does not decide for the reader.
   */
  async preview(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<{
    supported: boolean;
    reason?: string;
    fields: { field: string; from: unknown; to: unknown }[];
    changedAfter: number;
  }> {
    this.assertMayAsk(user);
    const log = await this.entry(tenantId, id);
    const rule = this.revertable[log.entityType];

    if (log.action !== 'UPDATE') {
      return {
        supported: false,
        reason: 'notAnEdit',
        fields: [],
        changedAfter: 0,
      };
    }
    if (log.redactedAt) {
      return {
        supported: false,
        reason: 'redacted',
        fields: [],
        changedAfter: 0,
      };
    }
    if (!rule) {
      return {
        supported: false,
        reason: 'entityNotSupported',
        fields: [],
        changedAfter: 0,
      };
    }

    const before = this.parse(log.beforeJson);
    const after = this.parse(log.afterJson);
    const fields = Object.keys(before)
      .filter((f) => rule.fields.includes(f))
      .map((f) => ({
        field: f,
        from: after[f] ?? null,
        to: before[f] ?? null,
      }));

    if (fields.length === 0) {
      return {
        supported: false,
        reason: 'nothingRevertable',
        fields: [],
        changedAfter: 0,
      };
    }

    const changedAfter = await this.logRepo.count({
      where: {
        congregationId: tenantId,
        entityType: log.entityType,
        entityId: log.entityId,
        createdAt: MoreThan(log.createdAt),
      },
    });

    return { supported: true, fields, changedAfter };
  }

  /** Apply it — through the module's own update, with the caller's rights. */
  async revert(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const plan = await this.preview(tenantId, id, user);
    if (!plan.supported) {
      throw new BadRequestException(plan.reason ?? 'Not revertable');
    }
    const log = await this.entry(tenantId, id);
    const rule = this.revertable[log.entityType];
    const dto: Record<string, unknown> = {};
    for (const f of plan.fields) dto[f.field] = f.to;
    await rule.apply(tenantId, log.entityId, dto, user);
  }

  private parse(json: string | null): Record<string, unknown> {
    if (!json) return {};
    try {
      const parsed: unknown = JSON.parse(json);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
