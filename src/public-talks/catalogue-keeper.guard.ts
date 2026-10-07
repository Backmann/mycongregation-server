import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Responsibility } from '../entities/responsibility.entity';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Who may set talks aside and bring them back.
 *
 * TWO RULES STOOD HERE FOR ONE ACT (found 6 October 2026, settled the 7th).
 * The server asked for the ROLE — an administrator or an elder. The screen
 * asked for the DUTY — the public talk coordinator or his assistant. Each was
 * reasonable alone and they disagreed in both directions:
 *
 *   - an assistant who is a ministerial servant was shown «Снять речи», and
 *     on «Проверить» was answered 403;
 *   - an elder who is not the coordinator could do it as far as the server
 *     was concerned, and had no button.
 *
 * Neither side was wrong about who is trusted with it: the letter arrives to
 * the body of elders, and the coordinator is the one who works with the
 * talks. So the rule is the two together, and lib/screen-access.ts in the app
 * says the same words — «talkCatalogue».
 */
export const CATALOGUE_KEEPER_RESPONSIBILITIES = [
  ResponsibilityType.PUBLIC_TALK_COORDINATOR,
  ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
];

@Injectable()
export class CatalogueKeeperGuard implements CanActivate {
  constructor(
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException('No user context');
    if (user.role === UserRole.ADMIN || user.role === UserRole.ELDER) {
      return true;
    }
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(CATALOGUE_KEEPER_RESPONSIBILITIES),
      },
    });
    if (held > 0) return true;
    throw new ForbiddenException(
      'Only elders and the public talk coordinator may set talks aside',
    );
  }
}
