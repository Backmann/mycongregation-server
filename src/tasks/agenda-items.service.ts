import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EldersMeeting } from '../entities/elders-meeting.entity';
import {
  EldersMeetingItem,
  ItemOutcome,
} from '../entities/elders-meeting-item.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

export interface ItemInput {
  title?: string;
  sourceText?: string | null;
  sourceUrl?: string | null;
  presenterPublisherId?: string | null;
  minutes?: number;
  outcome?: ItemOutcome | null;
  outcomeNote?: string | null;
  taskId?: string | null;
}

/**
 * The agenda's own items — who may touch them, and in what order they stand.
 *
 * THREE DIFFERENT RIGHTS live here, and they are not the same right:
 *
 *   BUILDING the agenda is the coordinator's (with his assistant, and an
 *   administrator). Questions reach him by letter and he decides what goes on.
 *   KEEPING THE RECORD during the meeting belongs to whoever was named for it
 *   — the secretary unless somebody else was chosen. He marks what became of
 *   each item and may add one when a question arises at the table.
 *   READING is every elder's, once the agenda is approved. Before that nobody
 *   else sees the items: an unfinished agenda read by five people is five
 *   conversations about something not yet decided.
 *
 * NOTHING IS LOST WHEN A MEETING ENDS. An item with no outcome moves to the
 * next meeting by itself, and if there is no next meeting yet it waits with no
 * meeting at all — the first one created picks it up. That is the whole reason
 * `meeting_id` is nullable.
 */
@Injectable()
export class AgendaItemsService {
  constructor(
    @InjectRepository(EldersMeetingItem)
    private readonly items: Repository<EldersMeetingItem>,
    @InjectRepository(EldersMeeting)
    private readonly meetings: Repository<EldersMeeting>,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
    @InjectRepository(Publisher)
    private readonly publishers: Repository<Publisher>,
  ) {}

  /** Does this person hold any of these assignments right now. */
  private async holds(
    user: AuthenticatedUser,
    types: ResponsibilityType[],
  ): Promise<boolean> {
    const count = await this.responsibilities.count({
      where: types.map((type) => ({
        congregationId: user.congregationId,
        userId: user.id,
        type,
      })),
    });
    return count > 0;
  }

  /** May he build and approve the agenda. */
  async mayBuild(user: AuthenticatedUser): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    return this.holds(user, [
      ResponsibilityType.BODY_COORDINATOR,
      ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
    ]);
  }

  /**
   * May he record what was decided.
   *
   * The brother named on the meeting, and nobody else — two people writing the
   * record at once overwrite each other, and the second finds his words gone.
   * An administrator passes, as everywhere.
   */
  async mayRecord(
    user: AuthenticatedUser,
    meeting: EldersMeeting,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;
    if (await this.mayBuild(user)) return true;
    if (!meeting.minuteTakerPublisherId) {
      // Nobody named: the secretary keeps the record by default.
      return this.holds(user, [ResponsibilityType.SECRETARY]);
    }
    const card = await this.publishers.findOne({
      where: {
        id: meeting.minuteTakerPublisherId,
        congregationId: user.congregationId,
      },
    });
    return card?.userId === user.id;
  }

  private async meetingOf(
    congregationId: string,
    meetingId: string,
  ): Promise<EldersMeeting> {
    const meeting = await this.meetings.findOne({
      where: { id: meetingId, congregationId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  /**
   * The items of a meeting — or nothing, while it is still a draft.
   *
   * The refusal is silent on purpose: an elder sees that a meeting is planned,
   * with its date and place, and simply no items yet. Telling him «hidden»
   * would invite him to ask what is being hidden.
   */
  async list(
    user: AuthenticatedUser,
    meetingId: string,
  ): Promise<EldersMeetingItem[]> {
    const meeting = await this.meetingOf(user.congregationId, meetingId);
    if (!meeting.approvedAt && !(await this.mayBuild(user))) return [];
    return this.items.find({
      where: { congregationId: user.congregationId, meetingId },
      order: { position: 'ASC', createdAt: 'ASC' },
      relations: { presenter: true },
    });
  }

  /** Items left over from before, waiting for a meeting to belong to. */
  async waiting(congregationId: string): Promise<EldersMeetingItem[]> {
    return this.items.find({
      where: { congregationId, meetingId: IsNull() },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(
    user: AuthenticatedUser,
    meetingId: string,
    dto: ItemInput & { title: string },
  ): Promise<EldersMeetingItem> {
    const meeting = await this.meetingOf(user.congregationId, meetingId);
    // Building it is the coordinator's; adding at the table is the recorder's,
    // because ideas do arise in the room and are worth writing down.
    if (!(await this.mayRecord(user, meeting))) {
      throw new ForbiddenException('Not allowed');
    }
    const last = await this.items.findOne({
      where: { congregationId: user.congregationId, meetingId },
      order: { position: 'DESC' },
    });
    return this.items.save(
      this.items.create({
        congregationId: user.congregationId,
        meetingId,
        position: (last?.position ?? 0) + 1,
        title: dto.title,
        sourceText: dto.sourceText ?? null,
        sourceUrl: dto.sourceUrl ?? null,
        presenterPublisherId: dto.presenterPublisherId ?? null,
        minutes: dto.minutes ?? 10,
        createdById: user.id,
      }),
    );
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: ItemInput,
  ): Promise<EldersMeetingItem> {
    const item = await this.items.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!item) throw new NotFoundException('Item not found');
    const meeting = item.meetingId
      ? await this.meetingOf(user.congregationId, item.meetingId)
      : null;
    const allowed = meeting
      ? await this.mayRecord(user, meeting)
      : await this.mayBuild(user);
    if (!allowed) throw new ForbiddenException('Not allowed');

    if (dto.title !== undefined) item.title = dto.title;
    if (dto.sourceText !== undefined) item.sourceText = dto.sourceText ?? null;
    if (dto.sourceUrl !== undefined) item.sourceUrl = dto.sourceUrl ?? null;
    if (dto.presenterPublisherId !== undefined) {
      item.presenterPublisherId = dto.presenterPublisherId ?? null;
    }
    if (dto.minutes !== undefined) item.minutes = dto.minutes;
    if (dto.outcome !== undefined) item.outcome = dto.outcome ?? null;
    if (dto.outcomeNote !== undefined) {
      item.outcomeNote = dto.outcomeNote ?? null;
    }
    if (dto.taskId !== undefined) item.taskId = dto.taskId ?? null;
    return this.items.save(item);
  }

  /** Move one item up or down; an agenda is a sequence, not a heap. */
  async move(
    user: AuthenticatedUser,
    id: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const item = await this.items.findOne({
      where: { id, congregationId: user.congregationId },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!(await this.mayBuild(user)))
      throw new ForbiddenException('Not allowed');

    const siblings = await this.items.find({
      where: {
        congregationId: user.congregationId,
        meetingId: item.meetingId ?? IsNull(),
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const at = siblings.findIndex((s) => s.id === id);
    const to = direction === 'up' ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= siblings.length) return;

    // Rewritten as a whole run rather than swapping two numbers: positions
    // drift when items are deleted, and a swap of drifted numbers can leave
    // two items claiming the same place.
    const reordered = [...siblings];
    const [moved] = reordered.splice(at, 1);
    reordered.splice(to, 0, moved);
    await Promise.all(
      reordered.map((s, i) => this.items.update(s.id, { position: i + 1 })),
    );
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    if (!(await this.mayBuild(user)))
      throw new ForbiddenException('Not allowed');
    await this.items.delete({ id, congregationId: user.congregationId });
  }

  /**
   * Carry what was not settled to the next meeting.
   *
   * Called when a meeting is closed. Items with no outcome — and those marked
   * «перенесён» — are detached from it; the next meeting created picks them up,
   * or the one given here takes them at once. Nothing is deleted: a question
   * nobody got to is still a question.
   */
  async carryOver(
    congregationId: string,
    fromMeetingId: string,
    toMeetingId: string | null = null,
  ): Promise<number> {
    const left = await this.items.find({
      where: { congregationId, meetingId: fromMeetingId },
    });
    const unsettled = left.filter(
      (i) => i.outcome === null || i.outcome === 'carried',
    );
    for (const item of unsettled) {
      item.meetingId = toMeetingId;
      item.outcome = null;
      await this.items.save(item);
    }
    return unsettled.length;
  }

  /**
   * A newly created meeting adopts whatever has been waiting.
   *
   * Otherwise a question carried over from May would sit unattached until
   * somebody noticed it, which is exactly the losing we set out to prevent.
   */
  async adoptWaiting(
    congregationId: string,
    meetingId: string,
  ): Promise<number> {
    const waiting = await this.waiting(congregationId);
    let i = 0;
    for (const item of waiting) {
      item.meetingId = meetingId;
      item.position = ++i;
      await this.items.save(item);
    }
    return waiting.length;
  }
}
