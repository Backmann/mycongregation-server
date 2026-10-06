import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { In, IsNull, Repository } from 'typeorm';
import {
  SpeakerMergeRecord,
  VisitingSpeaker,
} from '../entities/visiting-speaker.entity';
import { VisitingSpeakerDistinctPair } from '../entities/visiting-speaker-distinct-pair.entity';
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

/** The name as the journal of changes shows it. */
function speakerLabel(row: VisitingSpeaker): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ');
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
    @InjectRepository(VisitingSpeakerDistinctPair)
    private readonly distinctRepo: Repository<VisitingSpeakerDistinctPair>,
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

    const keepName = speakerLabel(keep);
    const mergeName = speakerLabel(merge);
    const talksBefore = [...keep.talkNumbers];

    // ОДНОЙ операцией (5 октября 2026). Раньше это были четыре отдельные
    // записи: сбой посередине оставлял визиты уже перенесёнными, а карточку —
    // ещё не помеченной, и двойник с пустой историей оставался в списке.
    const record = await this.repo.manager.transaction(async (m) => {
      const speakers = m.getRepository(VisitingSpeaker);
      const exchanges = m.getRepository(TalkExchange);
      const slots = m.getRepository(Assignment);

      // 0. ЧТО переезжает — записывается ДО переезда: после него визиты двух
      //    братьев неотличимы, и разъединять было бы не по чему.
      const exchangeIds = (
        await exchanges.find({
          where: { congregationId: tenantId, visitingSpeakerId: mergeId },
          select: { id: true },
        })
      ).map((r) => r.id);
      const assignmentIds = (
        await slots.find({
          where: { congregationId: tenantId, visitingSpeakerId: mergeId },
          select: { id: true },
        })
      ).map((r) => r.id);

      // 1. История переезжает. Записи журнала и слоты программы начинают
      //    указывать на оставшуюся карточку.
      await exchanges.update(
        { congregationId: tenantId, visitingSpeakerId: mergeId },
        { visitingSpeakerId: keepId },
      );
      await slots.update(
        { congregationId: tenantId, visitingSpeakerId: mergeId },
        { visitingSpeakerId: keepId },
      );

      // 2. Репертуар складывается, а не заменяется: речь, которую он говорил,
      //    остаётся его речью, под каким бы написанием имени её ни записали.
      const addedTalkNumbers = merge.talkNumbers.filter(
        (n) => !keep.talkNumbers.includes(n),
      );
      keep.talkNumbers = [
        ...new Set([...keep.talkNumbers, ...merge.talkNumbers]),
      ].sort((a, b) => a - b);
      // 3. Пустое у оставшейся заполняется из объединяемой.
      const filled: SpeakerMergeRecord['filled'] = [];
      if (keep.phone == null && merge.phone != null) {
        keep.phone = merge.phone;
        filled.push('phone');
      }
      if (keep.note == null && merge.note != null) {
        keep.note = merge.note;
        filled.push('note');
      }
      if (
        keep.externalCongregationId == null &&
        merge.externalCongregationId != null
      ) {
        keep.externalCongregationId = merge.externalCongregationId;
        filled.push('externalCongregationId');
      }
      // Карточка, заведённая приложением, перестаёт быть таковой, как только
      // в неё влилась заведённая человеком.
      const keepWasAutoCreated = keep.autoCreated && !merge.autoCreated;
      if (!merge.autoCreated) keep.autoCreated = false;
      // Один брат — одна карточка: если объединяемая была карточкой
      // районного, районным становится и оставшаяся.
      const keepBecameOverseer = merge.circuitOverseer && !keep.circuitOverseer;
      if (keepBecameOverseer) keep.circuitOverseer = true;
      await speakers.save(keep);

      // 4. След. Карточка остаётся, указывает, куда её объединили, и помнит,
      //    что с неё ушло.
      const rec: SpeakerMergeRecord = {
        at: new Date().toISOString(),
        byUserId: user.id ?? null,
        exchangeIds,
        assignmentIds,
        addedTalkNumbers,
        filled,
        keepWasAutoCreated,
        ...(keepBecameOverseer ? { keepBecameOverseer: true } : {}),
      };
      merge.mergedIntoId = keep.id;
      merge.mergeRecord = rec;
      await speakers.save(merge);
      return rec;
    });

    // В журнале — имя, а не номер карточки: строку читает человек.
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: keep.id,
      actorUserId: user.id,
      before: {
        mergedFrom: null,
        movedVisits: null,
        talkNumbers: talksBefore.join(', '),
      },
      after: {
        // Обе карточки в одной строке: журнал не подписывает, чья запись.
        mergedFrom: `${keepName} ← ${mergeName}`,
        movedVisits: record.exchangeIds.length,
        talkNumbers: keep.talkNumbers.join(', '),
      },
      fields: ['mergedFrom', 'movedVisits', 'talkNumbers'],
    });

    return this.findOne(tenantId, keep.id);
  }

  /**
   * Карточки, объединённые с этой, — чтобы оставшаяся показывала, что в ней
   * две истории, и давала их разобрать.
   */
  async listMerged(
    tenantId: string,
    keepId: string,
  ): Promise<
    Array<{
      id: string;
      firstName: string;
      lastName: string | null;
      mergedAt: string | null;
      visits: number | null;
      canUnmerge: boolean;
    }>
  > {
    const rows = await this.repo.find({
      where: { congregationId: tenantId, mergedIntoId: keepId },
      order: { updatedAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      mergedAt: r.mergeRecord?.at ?? null,
      visits: r.mergeRecord ? r.mergeRecord.exchangeIds.length : null,
      // Объединённые до 5 октября 2026 не помнят, что с них ушло.
      canUnmerge: !!r.mergeRecord,
    }));
  }

  /**
   * Это были разные братья: объединение разбирается.
   *
   * Возвращается РОВНО то, что переехало, — по записи, сделанной при
   * объединении. Визиты, появившиеся у оставшейся карточки позже, остаются
   * её: приложение не гадает, чьи они. Сведения, заполненные из объединённой
   * карточки, снимаются только если с тех пор их никто не менял; номера речей,
   * которых у оставшейся не было, уходят вместе с карточкой.
   *
   * После разъединения пара запоминается как «разные братья» — иначе
   * справочник тут же предложил бы объединить их снова.
   */
  async unmerge(
    tenantId: string,
    user: AuthenticatedUser,
    keepId: string,
    mergedId: string,
  ): Promise<VisitingSpeaker> {
    await this.assertCanWrite(user);
    const keep = await this.repo.findOne({
      where: { id: keepId, congregationId: tenantId },
    });
    const merged = await this.repo.findOne({
      where: { id: mergedId, congregationId: tenantId },
    });
    if (!keep || !merged) throw new NotFoundException('Speaker not found');
    if (merged.mergedIntoId !== keep.id) {
      throw new BadRequestException({
        code: 'NOT_MERGED_HERE',
        message: 'That card is not merged into this one',
      });
    }
    const rec = merged.mergeRecord;
    if (!rec) {
      throw new BadRequestException({
        code: 'NO_MERGE_RECORD',
        message:
          'This merge was made before merges were recorded and cannot be undone automatically',
      });
    }

    const keepName = speakerLabel(keep);
    const mergedName = speakerLabel(merged);
    const talksBefore = [...keep.talkNumbers];

    const returned = await this.repo.manager.transaction(async (m) => {
      const speakers = m.getRepository(VisitingSpeaker);
      const exchanges = m.getRepository(TalkExchange);
      const slots = m.getRepository(Assignment);

      // Только те, что всё ещё у оставшейся карточки: запись, которую с тех
      // пор отдали третьему докладчику, принадлежит уже ему.
      let visits = 0;
      if (rec.exchangeIds.length > 0) {
        const res = await exchanges.update(
          {
            congregationId: tenantId,
            visitingSpeakerId: keepId,
            id: In(rec.exchangeIds),
          },
          { visitingSpeakerId: mergedId },
        );
        visits = res.affected ?? 0;
      }
      if (rec.assignmentIds.length > 0) {
        await slots.update(
          {
            congregationId: tenantId,
            visitingSpeakerId: keepId,
            id: In(rec.assignmentIds),
          },
          { visitingSpeakerId: mergedId },
        );
      }

      keep.talkNumbers = keep.talkNumbers.filter(
        (n) => !rec.addedTalkNumbers.includes(n),
      );
      // Заполненное из объединённой снимается, только если оно всё ещё то же:
      // исправленный с тех пор телефон — уже сведения этой карточки.
      if (rec.filled.includes('phone') && keep.phone === merged.phone) {
        keep.phone = null;
      }
      if (rec.filled.includes('note') && keep.note === merged.note) {
        keep.note = null;
      }
      if (
        rec.filled.includes('externalCongregationId') &&
        keep.externalCongregationId === merged.externalCongregationId
      ) {
        keep.externalCongregationId = null;
      }
      if (rec.keepWasAutoCreated) keep.autoCreated = true;
      if (rec.keepBecameOverseer) keep.circuitOverseer = false;
      await speakers.save(keep);

      merged.mergedIntoId = null;
      merged.mergeRecord = null;
      await speakers.save(merged);

      await this.saveDistinct(
        m.getRepository(VisitingSpeakerDistinctPair),
        tenantId,
        keepId,
        mergedId,
        user.id ?? null,
      );
      return visits;
    });

    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: keep.id,
      actorUserId: user.id,
      before: {
        separatedFrom: null,
        returnedVisits: null,
        talkNumbers: talksBefore.join(', '),
      },
      after: {
        separatedFrom: `${keepName} ↔ ${mergedName}`,
        returnedVisits: returned,
        talkNumbers: keep.talkNumbers.join(', '),
      },
      fields: ['separatedFrom', 'returnedVisits', 'talkNumbers'],
    });

    return this.findOne(tenantId, keep.id);
  }

  /** Пары карточек, про которые уже сказано «это разные братья». */
  async listDistinct(tenantId: string): Promise<Array<[string, string]>> {
    const rows = await this.distinctRepo.find({
      where: { congregationId: tenantId },
    });
    return rows.map((r) => [r.speakerAId, r.speakerBId]);
  }

  /**
   * «Это разные братья»: справочник больше не подсказывает эту пару — никому
   * из тех, кто его ведёт. Объединить их руками по-прежнему можно.
   */
  async markDistinct(
    tenantId: string,
    user: AuthenticatedUser,
    firstId: string,
    secondId: string,
  ): Promise<void> {
    await this.assertCanWrite(user);
    if (firstId === secondId) {
      throw new BadRequestException({
        code: 'SAME_CARD',
        message: 'Pick two different cards',
      });
    }
    const first = await this.repo.findOne({
      where: { id: firstId, congregationId: tenantId },
    });
    const second = await this.repo.findOne({
      where: { id: secondId, congregationId: tenantId },
    });
    if (!first || !second) throw new NotFoundException('Speaker not found');
    const added = await this.saveDistinct(
      this.distinctRepo,
      tenantId,
      firstId,
      secondId,
      user.id ?? null,
    );
    if (!added) return;
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'visiting_speaker',
      entityId: first.id,
      actorUserId: user.id,
      before: { distinctFrom: null },
      after: {
        distinctFrom: `${speakerLabel(first)} · ${speakerLabel(second)}`,
      },
      fields: ['distinctFrom'],
    });
  }

  /** One order for a pair, and never twice. Returns whether a row was added. */
  private async saveDistinct(
    repo: Repository<VisitingSpeakerDistinctPair>,
    tenantId: string,
    firstId: string,
    secondId: string,
    userId: string | null,
  ): Promise<boolean> {
    const [speakerAId, speakerBId] = [firstId, secondId].sort();
    const there = await repo.findOne({
      where: { congregationId: tenantId, speakerAId, speakerBId },
    });
    if (there) return false;
    await repo.save(
      repo.create({
        congregationId: tenantId,
        speakerAId,
        speakerBId,
        createdByUserId: userId,
      }),
    );
    return true;
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
