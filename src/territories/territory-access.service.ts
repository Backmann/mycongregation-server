import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { TerritorySettings } from '../entities/territory-settings.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { refusal } from '../common/errors/refusal';

/** Those who keep the territories: they import, give out and take back. */
export const TERRITORY_KEEPERS: ResponsibilityType[] = [
  ResponsibilityType.TERRITORY_SERVANT,
  ResponsibilityType.TERRITORY_SERVANT_ASSISTANT,
];

/**
 * The service committee: it sees the whole section once the records are
 * confirmed (Lionel, 11 November 2026).
 */
export const TERRITORY_COMMITTEE: ResponsibilityType[] = [
  ResponsibilityType.BODY_COORDINATOR,
  ResponsibilityType.SECRETARY,
  ResponsibilityType.SERVICE_OVERSEER,
];

export interface TerritoryAccess {
  /** Sees every territory, every assignment, the boundary. */
  seesAll: boolean;
  /** Imports, gives out, takes back, confirms. */
  keeps: boolean;
  /** The brought-over records are confirmed and the section is open. */
  verified: boolean;
}

/**
 * Who may see and do what in the territory section (11 November 2026).
 *
 *  - administrators and the territory servant and his assistant: everything;
 *  - the service committee: sees everything — once the records are confirmed;
 *  - everybody else: nothing here. Holders, group overseers and group members
 *    see their own territories through the routes made for them (next stage).
 *
 * Until the records are confirmed the section is the keepers' alone.
 */
@Injectable()
export class TerritoryAccessService {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(TerritorySettings)
    private readonly settings: Repository<TerritorySettings>,
  ) {}

  async verifiedAt(congregationId: string): Promise<Date | null> {
    const row = await this.settings.findOne({ where: { congregationId } });
    return row?.verifiedAt ?? null;
  }

  async of(user: AuthenticatedUser): Promise<TerritoryAccess> {
    const verified = (await this.verifiedAt(user.congregationId)) !== null;
    if (user.role === UserRole.ADMIN) {
      return { seesAll: true, keeps: true, verified };
    }
    const held = await this.responsibilities.find({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([...TERRITORY_KEEPERS, ...TERRITORY_COMMITTEE]),
      },
      select: { type: true },
    });
    const types = held.map((r) => r.type as ResponsibilityType);
    const keeps = types.some((t) => TERRITORY_KEEPERS.includes(t));
    const committee = types.some((t) => TERRITORY_COMMITTEE.includes(t));
    return { seesAll: keeps || (committee && verified), keeps, verified };
  }

  /** Refuses unless the user sees the whole section. */
  async mustSeeAll(user: AuthenticatedUser): Promise<TerritoryAccess> {
    const access = await this.of(user);
    if (!access.seesAll) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Requires the territory section.', {
          responsibilities: [...TERRITORY_KEEPERS, ...TERRITORY_COMMITTEE],
        }),
      );
    }
    return access;
  }

  /** Refuses unless the user keeps the territories. */
  async mustKeep(user: AuthenticatedUser): Promise<TerritoryAccess> {
    const access = await this.of(user);
    if (!access.keeps) {
      throw new ForbiddenException(
        refusal('NEEDS_RESPONSIBILITY', 'Requires the territory servant.', {
          responsibilities: TERRITORY_KEEPERS,
        }),
      );
    }
    return access;
  }
}
