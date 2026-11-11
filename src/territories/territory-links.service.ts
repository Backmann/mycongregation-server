import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Territory } from '../entities/territory.entity';
import { TerritoryAssignment } from '../entities/territory-assignment.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';
import { todayIn } from '../common/congregation-clock';
import { TerritoryAccessService } from './territory-access.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';

/** How long a view link opened from the app works. */
const VIEW_SECONDS = 2 * 60 * 60;

const SHARE_RE = /^[A-Za-z0-9_-]{32}$/;
const VIEW_RE = /^v\.([0-9a-f]{32})\.([0-9a-z]{1,10})\.([0-9a-f]{32})$/;

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const dashes = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** What a page without login may show: the map of one territory, no more. */
export interface SharedTerritory {
  number: string;
  locality: string | null;
  geometry: Territory['geometry'];
  dueOn: string | null;
  /** For the map file's address. */
  congregationId: string;
  mapReady: boolean;
}

/**
 * Links without login to one territory's map (11 November 2026).
 *
 * Two kinds, one page:
 *  - a VIEW link, made when someone who sees the territory in the app opens
 *    its map in the phone's browser (the app has no map of its own yet).
 *    Signed, not stored, good for two hours;
 *  - a SHARE link, for a holder without the app or the partner he walks
 *    with. Only its hash is kept; a new one replaces the old; it works until
 *    the day the territory is due and stops the moment it comes back.
 *
 * The page shows the outline and the street map — never the «не
 * беспокоить» addresses, never a name. Every link that does not work gets
 * the same plain «not found»: nothing tells a wrong link from an old one.
 */
@Injectable()
export class TerritoryLinksService {
  constructor(
    private readonly access: TerritoryAccessService,
    private readonly given: TerritoryAssignmentsService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
    @InjectRepository(TerritoryAssignment)
    private readonly assignments: Repository<TerritoryAssignment>,
    @InjectRepository(Territory)
    private readonly territories: Repository<Territory>,
    @InjectRepository(TerritorySettings)
    private readonly settings: Repository<TerritorySettings>,
    @InjectRepository(Congregation)
    private readonly congregations: Repository<Congregation>,
  ) {}

  private secret(): string {
    const s = this.config.get<string>('jwt.secret');
    if (!s) throw new Error('jwt.secret is not configured');
    return s;
  }

  private sign(hexId: string, exp: string): string {
    return createHmac('sha256', this.secret())
      .update(`territory-view|${hexId}|${exp}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** The open assignment, or refused as if it did not exist. */
  private async openOne(congregationId: string, id: string) {
    const a = await this.assignments.findOne({
      where: { id, congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    if (a.completedOn || a.returnedOn) {
      throw new ConflictException(
        refusal('TERRITORY_ENDED', 'The territory has already come back.'),
      );
    }
    return a;
  }

  /** A two-hour link for someone who sees the territory in the app. */
  async viewLink(user: AuthenticatedUser, assignmentId: string) {
    const a = await this.openOne(user.congregationId, assignmentId);
    const access = await this.access.of(user);
    const sees =
      (access.seesAll && access.verified) ||
      (await this.given.mine(user)).some((t) => t.assignment.id === a.id);
    if (!sees) throw new NotFoundException('Assignment not found');
    const hexId = a.id.replace(/-/g, '');
    const exp = (Math.floor(Date.now() / 1000) + VIEW_SECONDS).toString(36);
    return { path: `/t/v.${hexId}.${exp}.${this.sign(hexId, exp)}` };
  }

  /** The holder's own, or a keeper's: a link until the day it is due. */
  private async mayShare(user: AuthenticatedUser, a: TerritoryAssignment) {
    const access = await this.access.of(user);
    if (access.keeps && access.verified) return;
    const me = await this.access.person(user);
    if (me.publisherId && a.publisherId === me.publisherId) return;
    throw new NotFoundException('Assignment not found');
  }

  async shareLink(user: AuthenticatedUser, assignmentId: string) {
    const a = await this.openOne(user.congregationId, assignmentId);
    await this.mayShare(user, a);
    const token = randomBytes(24).toString('base64url');
    await this.assignments.update(
      { id: a.id },
      { linkHash: hashOf(token), linkCreatedAt: new Date() },
    );
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_assignment',
      entityId: a.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { territoryId: a.territoryId, link: 'created' },
    });
    return { path: `/t/${token}`, dueOn: a.dueOn };
  }

  async revokeShare(user: AuthenticatedUser, assignmentId: string) {
    const a = await this.assignments.findOne({
      where: { id: assignmentId, congregationId: user.congregationId },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    await this.mayShare(user, a);
    await this.assignments.update(
      { id: a.id },
      { linkHash: null, linkCreatedAt: null },
    );
    await this.audit.logFact({
      tenantId: user.congregationId,
      entityType: 'territory_assignment',
      entityId: a.id,
      action: 'UPDATE',
      actorUserId: user.id,
      detail: { territoryId: a.territoryId, link: 'revoked' },
    });
    return { ok: true };
  }

  /** The page behind a link; null for every link that does not work. */
  async shared(token: string): Promise<SharedTerritory | null> {
    let a: TerritoryAssignment | null = null;
    let view = false;
    const v = VIEW_RE.exec(token);
    if (v) {
      const [, hexId, exp, sig] = v;
      const want = Buffer.from(this.sign(hexId, exp));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) {
        return null;
      }
      if (parseInt(exp, 36) * 1000 < Date.now()) return null;
      a = await this.assignments.findOne({ where: { id: dashes(hexId) } });
      view = true;
    } else if (SHARE_RE.test(token)) {
      a = await this.assignments.findOne({
        where: { linkHash: hashOf(token) },
      });
    }
    if (!a || a.completedOn || a.returnedOn) return null;
    if (!view) {
      const c = await this.congregations.findOne({
        where: { id: a.congregationId },
        select: { id: true, timezone: true },
      });
      const today = todayIn(new Date(), c?.timezone);
      if (a.dueOn && today > a.dueOn) return null;
    }
    const t = await this.territories.findOne({
      where: {
        id: a.territoryId,
        congregationId: a.congregationId,
        archivedAt: IsNull(),
      },
    });
    if (!t) return null;
    // The records must be confirmed: before that nobody is told anything.
    const s = await this.settings.findOne({
      where: { congregationId: a.congregationId },
    });
    if (!s?.verifiedAt) return null;
    return {
      number: t.number,
      locality: t.locality,
      geometry: t.geometry,
      dueOn: a.dueOn,
      congregationId: a.congregationId,
      mapReady: !!s.mapBuiltAt,
    };
  }
}
