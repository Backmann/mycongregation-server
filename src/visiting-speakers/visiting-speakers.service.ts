import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, IsNull, Repository } from 'typeorm';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateVisitingSpeakerDto } from './dto/create-visiting-speaker.dto';
import { UpdateVisitingSpeakerDto } from './dto/update-visiting-speaker.dto';

/**
 * What the journal remembers about a visiting speaker. The phone is a person's
 * contact detail, so it is recorded as the FACT that it changed and never as
 * the number itself — the same rule the publisher card follows.
 */
const SPEAKER_FIELDS = [
  'firstName',
  'lastName',
  'externalCongregationId',
  'note',
  'talkNumbers',
] as const;

function speakerSnapshot(row: VisitingSpeaker): Record<string, unknown> {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    externalCongregationId: row.externalCongregationId,
    note: row.note,
    talkNumbers: row.talkNumbers,
  };
}

@Injectable()
export class VisitingSpeakersService {
  constructor(
    @InjectRepository(VisitingSpeaker)
    private readonly repo: Repository<VisitingSpeaker>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    private readonly auditLog: AuditLogService,
    // Слияние переносит историю: записи журнала и слоты программы должны
    // начать указывать на оставшуюся карточку.
    @InjectRepository(TalkExchange)
    private readonly talkExchangeRepo: Repository<TalkExchange>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
  ) {}

  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.PUBLIC_TALK_COORDINATOR,
    // Помощник ведёт те же справочники: иначе он может заменить докладчика,
    // но не может завести карточку тому, кого заменил.
    ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
  ];

  /** Admins and the public talk coordinator may edit; everyone else may read. */
  private async assertCanWrite(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(VisitingSpeakersService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        'Only the public talk coordinator may edit visiting speakers',
      );
    }
  }

  findAll(tenantId: string): Promise<VisitingSpeaker[]> {
    return this.repo.find({
      // Объединённые не показываются: их визиты уже переехали к оставшейся
      // карточке, и предлагать их к выбору значило бы разводить двойников
      // заново.
      where: { congregationId: tenantId, mergedIntoId: IsNull() },
      relations: { externalCongregation: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<VisitingSpeaker> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
      relations: { externalCongregation: true },
    });
    if (!row) throw new NotFoundException('Visiting speaker not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateVisitingSpeakerDto,
    user: AuthenticatedUser,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const row = this.repo.create({ ...dto, congregationId: tenantId });
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: saved.id,
      after: speakerSnapshot(saved),
    });
    return saved;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateVisitingSpeakerDto,
    user: AuthenticatedUser,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    const before = speakerSnapshot(row);
    const phoneBefore = row.phone;
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: saved.id,
      before,
      after: speakerSnapshot(saved),
      fields: [...SPEAKER_FIELDS],
    });
    if (phoneBefore !== saved.phone) {
      // The number itself never enters the journal — only that it moved.
      await this.auditLog.logRawUpdate({
        tenantId,
        entityType: 'visiting_speaker',
        entityId: saved.id,
        changedFields: ['phone'],
        before: { phone: '<скрыто>' },
        after: { phone: '<скрыто>' },
      });
    }
    return saved;
  }

  /**
   * Два имени — один брат.
   *
   * «Иван Ротарюк» и «Rotariuk Iwan» заводятся как двое, потому что связь
   * визита с человеком выводится по точному совпадению имени. История при
   * этом делится надвое ровно там, где она нужна: когда решают, кого звать.
   *
   * Что переезжает: визиты журнала, ссылки из программы, номера речей. Что
   * берётся у оставшейся: имя, собрание, телефон, заметка — но ПУСТОЕ поле
   * заполняется из объединяемой, иначе слияние теряло бы сведения, ради
   * которых его и делают.
   *
   * Объединённая карточка остаётся со ссылкой на оставшуюся. Приложение не
   * решает за человека, что это точно один брат: тёзки бывают, и разъединять
   * должно быть по чему.
   */
  async merge(
    tenantId: string,
    user: AuthenticatedUser,
    keepId: string,
    mergeId: string,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    if (keepId === mergeId) {
      throw new BadRequestException({
        code: 'SAME_CARD',
        message: 'Pick two different cards',
      });
    }

    const keep = await this.repo.findOne({
      where: { id: keepId, congregationId: tenantId },
    });
    const merge = await this.repo.findOne({
      where: { id: mergeId, congregationId: tenantId },
    });
    if (!keep || !merge) throw new NotFoundException('Speaker not found');
    if (keep.mergedIntoId || merge.mergedIntoId) {
      throw new BadRequestException({
        code: 'ALREADY_MERGED',
        message: 'One of these cards is already merged into another',
      });
    }

    /**
     * Снимок для журнала изменений — плоский, как и у остальных записей:
     * тип сверяет ключи «до» и «после», и вложенные объекты он не примет.
     */
    const before: Record<string, unknown> = {
      talkNumbers: [...keep.talkNumbers],
      mergedFrom: null,
    };

    // 1. История переезжает. Записи журнала и слоты программы начинают
    //    указывать на оставшуюся карточку.
    await this.talkExchangeRepo.update(
      { congregationId: tenantId, visitingSpeakerId: mergeId },
      { visitingSpeakerId: keepId },
    );
    await this.assignmentRepo.update(
      { congregationId: tenantId, visitingSpeakerId: mergeId },
      { visitingSpeakerId: keepId },
    );

    // 2. Репертуар складывается, а не заменяется: речь, которую он говорил,
    //    остаётся его речью, под каким бы написанием имени её ни записали.
    keep.talkNumbers = [
      ...new Set([...keep.talkNumbers, ...merge.talkNumbers]),
    ].sort((a, b) => a - b);
    // 3. Пустое у оставшейся заполняется из объединяемой.
    keep.phone = keep.phone ?? merge.phone;
    keep.note = keep.note ?? merge.note;
    keep.externalCongregationId =
      keep.externalCongregationId ?? merge.externalCongregationId;
    // Карточка, заведённая приложением, перестаёт быть таковой, как только в
    // неё влилась заведённая человеком.
    if (!merge.autoCreated) keep.autoCreated = false;
    await this.repo.save(keep);

    // 4. След. Карточка остаётся и указывает, куда её объединили.
    merge.mergedIntoId = keep.id;
    await this.repo.save(merge);

    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: keep.id,
      before,
      after: {
        talkNumbers: [...keep.talkNumbers],
        mergedFrom: merge.id,
      },
      fields: ['talkNumbers', 'mergedFrom'],
    });

    return this.findOne(tenantId, keep.id);
  }

  async remove(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertCanWrite(user);
    const row = await this.findOne(tenantId, id);
    await this.auditLog.logEvent({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: row.id,
      action: 'DELETE',
      detail: { firstName: row.firstName, lastName: row.lastName },
    });
    await this.repo.softDelete(row.id);
  }
}
