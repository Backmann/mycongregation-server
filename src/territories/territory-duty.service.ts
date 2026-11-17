import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Territory } from '../entities/territory.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritoryRequest } from '../entities/territory-request.entity';
import { TerritoryStreetMark } from '../entities/territory-street-mark.entity';
import { TerritoryBoundary } from '../entities/territory-boundary.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Congregation } from '../entities/congregation.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import {
  TERRITORY_KEEPERS,
  TerritoryAccessService,
} from './territory-access.service';
import { holderNameOf } from './territory-assignments.service';
import { boxOf, checkGeometry, GeometryError, pointInside } from './geometry';
import type { TerritoryGeometry } from '../entities/territory.entity';
import { namesKeptFrom } from './territory-retention';
import { serviceYearOf, serviceYearStart } from './service-year';
import { askedWords, notNowWords } from './territory-words';

/** An id that never matches: `In([])` is not valid SQL. */
const NONE = '00000000-0000-0000-0000-000000000000';

/** A year back and two, from a day: the same day of the month. */
export function yearsBack(today: string, years: number): string {
  return `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
}

/**
 * How the whole territory is covered (17 November 2026): «the publishers
 * try to cover all the congregation's territory at least once a year; areas
 * not covered for two years or longer the elders discuss with the circuit
 * overseer». A territory counts by the last day it was worked, held or not —
 * a territory a year in someone's hands unworked is a year unworked.
 */
export function coverageOf(
  lastWorked: (string | null)[],
  today: string,
): {
  total: number;
  within12: number;
  oneToTwo: number;
  overTwo: number;
  noRecord: number;
  sinceYear: number;
} {
  const y1 = yearsBack(today, 1);
  const y2 = yearsBack(today, 2);
  const start = serviceYearStart(serviceYearOf(today));
  let within12 = 0;
  let oneToTwo = 0;
  let overTwo = 0;
  // No record of it ever being worked (a territory just cut, or one whose
  // paper card was not carried over): unknown, not «two years» — counted
  // apart so the elders check it rather than report it (17 November 2026).
  let noRecord = 0;
  let sinceYear = 0;
  for (const d of lastWorked) {
    if (!d) {
      noRecord++;
      continue;
    }
    if (d >= start) sinceYear++;
    if (d >= y1) within12++;
    else if (d >= y2) oneToTwo++;
    else overTwo++;
  }
  return {
    total: lastWorked.length,
    within12,
    oneToTwo,
    overTwo,
    noRecord,
    sinceYear,
  };
}

/**
 * The holder's duty and what the keepers need to carry theirs (17 November
 * 2026; mockup boards 7–17, «Организованы…» ch. 9 §31–34):
 *  - «Мои участки»: his own past lines, his request, what stops one, the
 *    territory servant's name, how far each territory he holds is worked;
 *  - «Попросить участок» and the keepers' «not now»;
 *  - how far a territory is worked, by the «street walked» marks;
 *  - the coverage of the whole territory and the list of two years and
 *    longer for the service committee;
 *  - the congregation's boundary: the branch's S-54, replaced only by a new
 *    file from the branch.
 */
@Injectable()
export class TerritoryDutyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: TerritoryAccessService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(TerritoryRequest)
    private readonly requests: Repository<TerritoryRequest>,
    @InjectRepository(TerritoryStreetMark)
    private readonly marks: Repository<TerritoryStreetMark>,
    @InjectRepository(TerritoryBoundary)
    private readonly boundaries: Repository<TerritoryBoundary>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  private async today(congregationId: string): Promise<string> {
    const c = await this.congregations.findOne({
      where: { id: congregationId },
      select: { id: true, timezone: true },
    });
    return todayIn(new Date(), c?.timezone);
  }

  // ----------------------------------------------------------------- me --

  /** Whether he may ask for a territory: a card in use, the section open. */
  async mayAsk(user: AuthenticatedUser): Promise<boolean> {
    if ((await this.access.verifiedAt(user.congregationId)) === null) {
      return false;
    }
    const me = await this.access.person(user);
    if (!me.publisherId) return false;
    const card = await this.publishers.findOne({
      where: { id: me.publisherId, congregationId: user.congregationId },
      select: { id: true, isActive: true, removedAt: true },
    });
    return !!card && card.isActive && !card.removedAt;
  }

  /** What «Мои участки» shows beside the territories themselves. */
  async me(user: AuthenticatedUser) {
    const tenantId = user.congregationId;
    const verified = (await this.access.verifiedAt(tenantId)) !== null;
    const me = await this.access.person(user);
    const card = me.publisherId
      ? await this.publishers.findOne({
          where: { id: me.publisherId, congregationId: tenantId },
          select: { id: true, isActive: true, removedAt: true },
        })
      : null;
    const mayAsk = verified && !!card && card.isActive && !card.removedAt;
    if (!verified || !card) {
      return {
        mayAsk: false,
        request: null,
        overdue: [],
        keeper: null,
        past: [],
        progress: {},
      };
    }
    const today = await this.today(tenantId);
    const held = await this.assignments.find({
      where: {
        congregationId: tenantId,
        publisherId: card.id,
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
    });
    const numbers = await this.numbersOf(
      tenantId,
      held.map((a) => a.territoryId),
    );
    const overdue = held
      .filter((a) => a.dueOn !== null && a.dueOn < today)
      .map((a) => ({
        number: numbers.get(a.territoryId) ?? '',
        dueOn: a.dueOn,
      }));
    const request = await this.requests.findOne({
      where: {
        congregationId: tenantId,
        publisherId: card.id,
        closedAt: IsNull(),
      },
    });
    const keptFrom = namesKeptFrom(today);
    const ended = await this.dataSource.query<
      {
        number: string;
        assigned_on: string;
        completed_on: string | null;
        returned_on: string | null;
        transferred: boolean;
        method: string | null;
      }[]
    >(
      `SELECT t.number, a.assigned_on::text, a.completed_on::text,
              a.returned_on::text, a.transferred, a.method
         FROM territory_assignments a
         JOIN territories t ON t.id = a.territory_id
        WHERE a.congregation_id = $1 AND a.publisher_id = $2
          AND COALESCE(a.completed_on, a.returned_on) >= $3
        ORDER BY COALESCE(a.completed_on, a.returned_on) DESC, a.created_at DESC`,
      [tenantId, card.id, keptFrom],
    );
    return {
      mayAsk,
      request: request
        ? { id: request.id, createdAt: request.createdAt }
        : null,
      overdue,
      keeper: await this.keeperName(tenantId),
      past: ended.map((r) => ({
        number: r.number,
        assignedOn: r.assigned_on,
        completedOn: r.completed_on,
        returnedOn: r.returned_on,
        transferred: r.transferred,
        method: r.method,
      })),
      progress: await this.progressOf(tenantId, held),
    };
  }

  /** The territory servant's name, to talk to; else his assistant's. */
  private async keeperName(congregationId: string): Promise<string | null> {
    for (const type of [
      ResponsibilityType.TERRITORY_SERVANT,
      ResponsibilityType.TERRITORY_SERVANT_ASSISTANT,
    ]) {
      const r = await this.responsibilities.findOne({
        where: { congregationId, type },
        select: { id: true, userId: true },
      });
      if (!r?.userId) continue;
      const p = await this.publishers.findOne({
        where: { congregationId, userId: r.userId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (p) return holderNameOf(p);
    }
    return null;
  }

  private async numbersOf(congregationId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, string>();
    const rows = await this.territories.find({
      where: { congregationId, id: In([...new Set(ids)]) },
      select: { id: true, number: true },
      withDeleted: true,
    });
    return new Map(rows.map((t) => [t.id, t.number]));
  }

  // ---------------------------------------------------------- progress --

  /**
   * How far each line is worked, in per cent of the territory's homes, by
   * the «street walked» marks. A territory nobody marked has no figure — not
   * «0 %», which would say something nobody knows. Keyed by territory id.
   */
  async progressOf(
    congregationId: string,
    lines: Pick<TerritoryAssignment, 'id' | 'territoryId'>[],
  ): Promise<Record<string, number>> {
    if (lines.length === 0) return {};
    const marks = await this.marks.find({
      where: { congregationId, assignmentId: In(lines.map((l) => l.id)) },
      select: { id: true, assignmentId: true, homes: true },
    });
    if (marks.length === 0) return {};
    const walked = new Map<string, Set<string>>();
    for (const m of marks) {
      const set = walked.get(m.assignmentId) ?? new Set<string>();
      for (const h of m.homes) set.add(String(h));
      walked.set(m.assignmentId, set);
    }
    const out: Record<string, number> = {};
    for (const l of lines) {
      const done = walked.get(l.id);
      if (!done || done.size === 0) continue;
      const t = await this.territories.findOne({
        where: { id: l.territoryId, congregationId },
        select: { id: true, geometry: true, congregationId: true },
      });
      if (!t) continue;
      const homes = await this.homesIn(t);
      if (homes.size === 0) continue;
      let n = 0;
      for (const h of done) if (homes.has(h)) n++;
      out[l.territoryId] = Math.min(100, Math.round((n * 100) / homes.size));
    }
    return out;
  }

  /** The homes of the map's register inside a territory (as the division). */
  private async homesIn(t: Pick<Territory, 'geometry' | 'congregationId'>) {
    const [x0, y0, x1, y1] = boxOf(t.geometry);
    const rows = await this.dataSource.query<
      { osm_id: string; lon: number; lat: number }[]
    >(
      `SELECT osm_id, lon, lat FROM map_houses
        WHERE congregation_id = $1 AND home
          AND lat BETWEEN $2 AND $3 AND lon BETWEEN $4 AND $5`,
      [t.congregationId, y0, y1, x0, x1],
    );
    return new Set(
      rows
        .filter((r) => pointInside([r.lon, r.lat], t.geometry))
        .map((r) => String(r.osm_id)),
    );
  }

  // ---------------------------------------------------------- requests --

  /**
   * «Попросить участок»: a personal territory is asked of the territory
   * servant (ch. 9 §32). Not while a territory he holds is overdue — first
   * the one taken on. Asking twice is the same request.
   */
  async ask(user: AuthenticatedUser) {
    const tenantId = user.congregationId;
    const mine = await this.me(user);
    if (!mine.mayAsk) {
      throw new BadRequestException(
        refusal('PERSON_NOT_ASSIGNABLE', 'You cannot ask for a territory.'),
      );
    }
    if (mine.overdue.length > 0) {
      throw new ConflictException(
        refusal(
          'TERRITORY_ASK_OVERDUE',
          'First the territory that is overdue.',
          {
            number: mine.overdue.map((o) => o.number).join(', '),
          },
        ),
      );
    }
    if (mine.request) return mine.request;
    const me = await this.access.person(user);
    let saved: TerritoryRequest;
    try {
      saved = await this.requests.save(
        this.requests.create({
          congregationId: tenantId,
          publisherId: me.publisherId!,
          closedAt: null,
          closedHow: null,
          closedByUserId: null,
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        const open = await this.requests.findOne({
          where: {
            congregationId: tenantId,
            publisherId: me.publisherId!,
            closedAt: IsNull(),
          },
        });
        if (open) return { id: open.id, createdAt: open.createdAt };
      }
      throw e;
    }
    const keepers = await this.responsibilities.find({
      where: { congregationId: tenantId, type: In(TERRITORY_KEEPERS) },
      select: { id: true, userId: true },
    });
    const userIds = [
      ...new Set(keepers.map((k) => k.userId).filter((u): u is string => !!u)),
    ].filter((u) => u !== user.id);
    if (userIds.length > 0) {
      await this.notifications.notify({
        tenantId,
        userIds,
        kind: 'territory_request',
        key: `territory-request:${saved.id}`,
        text: (lang) => askedWords(lang),
        data: { type: 'territory_keeper' },
      });
    }
    return { id: saved.id, createdAt: saved.createdAt };
  }

  /** He takes his request back. */
  async cancel(user: AuthenticatedUser) {
    const me = await this.access.person(user);
    if (!me.publisherId) return { closed: 0 };
    const r = await this.requests.update(
      {
        congregationId: user.congregationId,
        publisherId: me.publisherId,
        closedAt: IsNull(),
      },
      { closedAt: new Date(), closedHow: 'cancelled', closedByUserId: user.id },
    );
    return { closed: r.affected ?? 0 };
  }

  /**
   * The keepers' «Пока нет свободных» (ch. 9 §31: personal territories when
   * there are enough). The request closes; he is told and may ask again.
   */
  async notNow(user: AuthenticatedUser, id: string) {
    await this.access.mustKeep(user);
    const r = await this.requests.findOne({
      where: { id, congregationId: user.congregationId, closedAt: IsNull() },
    });
    if (!r) throw new NotFoundException('Request not found');
    r.closedAt = new Date();
    r.closedHow = 'none';
    r.closedByUserId = user.id;
    await this.requests.save(r);
    const p = await this.publishers.findOne({
      where: { id: r.publisherId, congregationId: user.congregationId },
      select: { id: true, userId: true },
    });
    if (p?.userId) {
      await this.notifications.notify({
        tenantId: user.congregationId,
        userIds: [p.userId],
        kind: 'territory_request_answer',
        key: `territory-request-none:${r.id}`,
        text: (lang) => notNowWords(lang),
        data: { type: 'territory' },
      });
    }
    return { closed: 1 };
  }

  /** The open requests, oldest first, for the keepers' «Нужно сделать». */
  async openRequests(congregationId: string) {
    const rows = await this.requests.find({
      where: { congregationId, closedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      publisherId: r.publisherId,
      createdAt: r.createdAt,
    }));
  }

  // ---------------------------------------------------------- coverage --

  /** The last day each territory in use was worked (as the summary counts). */
  private async lastWorked(congregationId: string) {
    const rows = await this.territories.find({
      where: { congregationId, archivedAt: IsNull() },
      select: {
        id: true,
        number: true,
        locality: true,
        category: true,
        lastCompletedOn: true,
      },
    });
    const lines = await this.dataSource.query<
      { territory_id: string; last: string | null }[]
    >(
      `SELECT a.territory_id, MAX(a.completed_on)::text AS last
         FROM territory_assignments a
         JOIN territories t ON t.id = a.territory_id
        WHERE a.congregation_id = $1
          AND (t.worked_from IS NULL OR a.completed_on >= t.worked_from)
        GROUP BY a.territory_id`,
      [congregationId],
    );
    const lastOf = new Map(lines.map((r) => [r.territory_id, r.last]));
    return rows.map((t) => ({
      t,
      last:
        [t.lastCompletedOn, lastOf.get(t.id) ?? null]
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null,
    }));
  }

  /** «Охват за год» for the desk: residential and business apart. */
  async coverage(congregationId: string) {
    const today = await this.today(congregationId);
    const all = await this.lastWorked(congregationId);
    const of = (business: boolean) =>
      coverageOf(
        all
          .filter((x) => (x.t.category === 'business') === business)
          .map((x) => x.last),
        today,
      );
    return { residential: of(false), business: of(true) };
  }

  /**
   * «Не обработаны 2 года и дольше» — the service committee and the keepers
   * (Lionel, 17 November 2026): for the elders' talk with the circuit
   * overseer; preliminary while the records are young.
   */
  async longUnworked(user: AuthenticatedUser) {
    await this.access.mustSeeAll(user);
    const tenantId = user.congregationId;
    const today = await this.today(tenantId);
    const y2 = yearsBack(today, 2);
    const every = await this.lastWorked(tenantId);
    const noRecord = every.filter((x) => !x.last).length;
    const all = every.filter((x) => !!x.last && x.last < y2);
    const held = await this.assignments.find({
      where: {
        congregationId: tenantId,
        territoryId: In(all.length ? all.map((x) => x.t.id) : [NONE]),
        completedOn: IsNull(),
        returnedOn: IsNull(),
      },
      select: { id: true, territoryId: true, assignedOn: true },
    });
    const since = new Map(held.map((a) => [a.territoryId, a.assignedOn]));
    const settings = await this.access.verifiedAt(tenantId);
    return {
      today,
      recordsFrom: settings ? settings.toISOString().slice(0, 10) : null,
      noRecord,
      items: all
        .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
        .map((x) => ({
          territoryId: x.t.id,
          number: x.t.number,
          locality: x.t.locality,
          category: x.t.category,
          lastWorkedOn: x.last,
          heldSince: since.get(x.t.id) ?? null,
        })),
    };
  }

  // ---------------------------------------------------------- boundary --

  /** The date of the S-54 the boundary in force follows. */
  async setS54(user: AuthenticatedUser, s54On: string) {
    await this.access.mustKeep(user);
    const b = await this.boundaries.findOne({
      where: { congregationId: user.congregationId },
      order: { createdAt: 'DESC' },
    });
    if (!b) throw new NotFoundException('Boundary not found');
    b.s54On = s54On;
    await this.boundaries.save(b);
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_boundary',
      entityId: b.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { s54On },
    });
    return { id: b.id, s54On };
  }

  /**
   * Before a new boundary from the branch replaces the one in force: which
   * territories would reach past it. Nothing is saved.
   */
  async previewBoundary(user: AuthenticatedUser, raw: unknown) {
    await this.access.mustKeep(user);
    const geometry = this.geometryOf(raw);
    const rows = await this.territories.find({
      where: { congregationId: user.congregationId, archivedAt: IsNull() },
      select: { id: true, number: true, geometry: true },
    });
    const outside = rows
      .filter((t) =>
        verticesOf(t.geometry).some((p) => !pointInside(p, geometry)),
      )
      .map((t) => t.number)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { outside };
  }

  /**
   * A new boundary from the branch (Lionel, 17 November 2026: the boundary
   * the branch set is not changed in the app — only replaced by a new file
   * from the branch). The date of its S-54 is required; the old one stays in
   * the history.
   */
  async replaceBoundary(
    user: AuthenticatedUser,
    raw: unknown,
    s54On: string | undefined,
  ) {
    await this.access.mustKeep(user);
    if (!s54On) {
      throw new BadRequestException(
        refusal('TERRITORY_BOUNDARY_S54', 'The date of the S-54 is required.'),
      );
    }
    const geometry = this.geometryOf(raw);
    const saved = await this.boundaries.save(
      this.boundaries.create({
        congregationId: user.congregationId,
        geometry,
        description: null,
        validFrom: s54On,
        s54On,
        createdByUserId: user.id,
      }),
    );
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_boundary',
      entityId: saved.id,
      action: 'CREATE',
      actorUserId: user.id,
      detail: { s54On, replaced: true },
    });
    return { id: saved.id, s54On };
  }

  private geometryOf(raw: unknown): TerritoryGeometry {
    try {
      return checkGeometry(raw);
    } catch (e) {
      if (e instanceof GeometryError) {
        throw new BadRequestException(
          refusal('TERRITORY_GEOMETRY', `boundary: ${e.message}`, {
            number: 'boundary',
            reason: e.message,
          }),
        );
      }
      throw e;
    }
  }
}

/** Every corner of a polygon or multipolygon. */
function verticesOf(g: TerritoryGeometry): [number, number][] {
  const polys =
    g.type === 'Polygon'
      ? [g.coordinates as number[][][]]
      : (g.coordinates as number[][][][]);
  const out: [number, number][] = [];
  for (const poly of polys)
    for (const ring of poly.slice(0, 1))
      for (const p of ring) out.push([p[0], p[1]]);
  return out;
}
