import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../../entities/assignment.entity';
import { LocalNeedsTopic } from '../../entities/local-needs-topic.entity';
import { AssignmentStatus } from '../../common/enums/assignment-status.enum';
import { EventType } from '../../common/enums/event-type.enum';
import { AssignmentsService } from '../../assignments/assignments.service';
import type { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { mondayOf } from '../../common/week';
import { refusal } from '../../common/errors/refusal';
import { LocalNeedsService } from '../local-needs.service';
import { PlaceLocalNeedsTopicDto } from '../dto/place-local-needs-topic.dto';

/**
 * «Поставить на неделю»: the topic becomes a part of the programme.
 *
 * It lives apart from LocalNeedsService because it writes the part through
 * AssignmentsService — the same door the schedule editor uses, so a published
 * week tells its speaker and the edited-after-publish rules hold — and
 * AssignmentsService already reaches LocalNeedsService (to release a topic
 * when its part changes). A module of its own keeps that one-way.
 *
 * The part takes the topic's title and nothing else: the speaker receives
 * the subject, as before (Lionel: «содержание не нужно»). An intended speaker
 * is put on the part only when the part has nobody yet.
 */
@Injectable()
export class LocalNeedsPlacementService {
  constructor(
    @InjectRepository(LocalNeedsTopic)
    private readonly topics: Repository<LocalNeedsTopic>,
    @InjectRepository(Assignment)
    private readonly parts: Repository<Assignment>,
    private readonly assignments: AssignmentsService,
    private readonly localNeeds: LocalNeedsService,
  ) {}

  async place(
    tenantId: string,
    topicId: string,
    dto: PlaceLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<LocalNeedsTopic> {
    await this.localNeeds.assertCanManage(user);
    const topic = await this.topics.findOne({
      where: { id: topicId, congregationId: tenantId },
    });
    if (!topic) throw new NotFoundException('Local needs topic not found');
    const week = mondayOf(dto.weekStartDate);

    const midweek = await this.parts
      .createQueryBuilder('a')
      .where('a.congregation_id = :tenantId', { tenantId })
      .andWhere('a.event_type = :midweek', { midweek: EventType.MIDWEEK })
      .andWhere('a.week_start_date = :week', { week })
      .andWhere('a.deleted_at IS NULL')
      .orderBy('a.part_order', 'ASC')
      .getMany();
    if (midweek.length === 0) {
      throw new BadRequestException(
        refusal(
          'LOCAL_NEEDS_NO_PROGRAMME',
          'The programme of this week is not there yet',
        ),
      );
    }

    let partId: string;
    if (dto.assignmentId) {
      const part = midweek.find((a) => a.id === dto.assignmentId);
      if (!part || !part.partKey.startsWith('living_christians')) {
        throw new BadRequestException(
          refusal(
            'LOCAL_NEEDS_NOT_A_PART',
            'Only a «Living as Christians» part of that week can take a topic',
          ),
        );
      }
      const speak =
        !part.publisherId && topic.speakerPublisherId
          ? { publisherId: topic.speakerPublisherId }
          : {};
      await this.assignments.update(
        tenantId,
        part.id,
        { partTitle: topic.title, ...speak },
        user,
      );
      partId = part.id;
    } else {
      partId = await this.addPart(tenantId, week, midweek, topic, dto, user);
    }
    return this.localNeeds.bindToPart(tenantId, topic.id, week, partId);
  }

  /**
   * One more «В жизни христианина» part, after the last one — as the
   * schedule editor adds it: the parts behind it move one place down.
   */
  private async addPart(
    tenantId: string,
    week: string,
    midweek: Assignment[],
    topic: LocalNeedsTopic,
    dto: PlaceLocalNeedsTopicDto,
    user: AuthenticatedUser,
  ): Promise<string> {
    const living = midweek.filter((a) =>
      a.partKey.startsWith('living_christians'),
    );
    const cbs = midweek.filter((a) => a.partKey.startsWith('cbs'));
    const anchor = living.length
      ? Math.max(...living.map((a) => a.partOrder))
      : cbs.length
        ? Math.min(...cbs.map((a) => a.partOrder)) - 1
        : Math.max(...midweek.map((a) => a.partOrder));
    const order = anchor + 1;
    const behind = midweek
      .filter((a) => a.partOrder >= order)
      .sort((a, b) => b.partOrder - a.partOrder);
    for (const a of behind) {
      await this.assignments.update(
        tenantId,
        a.id,
        { partOrder: a.partOrder + 1 },
        user,
      );
    }
    const published = midweek.some(
      (a) => a.status === AssignmentStatus.PUBLISHED,
    );
    const created = await this.assignments.create(
      tenantId,
      {
        weekStartDate: week,
        eventType: EventType.MIDWEEK,
        partKey: 'living_christians_extra',
        partOrder: order,
        partTitle: topic.title,
        // Asked for, else what the topic is meant for, else none.
        partDurationMin: dto.durationMin ?? topic.durationMin ?? undefined,
        status: published ? AssignmentStatus.PUBLISHED : AssignmentStatus.DRAFT,
        ...(topic.speakerPublisherId
          ? { publisherId: topic.speakerPublisherId }
          : {}),
      },
      user,
    );
    return created.id;
  }
}
