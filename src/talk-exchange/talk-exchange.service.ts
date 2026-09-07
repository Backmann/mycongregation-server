import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Between, MoreThanOrEqual, In, Not, Repository } from 'typeorm';
import { TalkExchange } from '../entities/talk-exchange.entity';
import { Assignment } from '../entities/assignment.entity';
import { Absence } from '../entities/absence.entity';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { PublicTalk } from '../entities/public-talk.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateTalkExchangeDto } from './dto/create-talk-exchange.dto';
import { UpdateTalkExchangeDto } from './dto/update-talk-exchange.dto';
import { ReplaceSpeakerDto } from './dto/replace-speaker.dto';
import { mondayOf } from '../common/week';

const PUBLIC_TALK_PART_KEY = 'public_talk_speaker';

/** dateStr + n days, as YYYY-MM-DD (UTC). */
function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function speakerFullName(s: {
  firstName: string;
  lastName: string | null;
}): string {
  return [s.firstName, s.lastName].filter(Boolean).join(' ');
}

export type TalkExchangeResult = TalkExchange & { programConflict?: boolean };

/**
 * The fields of a talk-exchange entry worth remembering in the journal — who
 * speaks, when, on what, who hosts, and how it stands. Deliberately not the
 * whole row: linked ids and timestamps say nothing to a reader.
 */
function snapshot(row: TalkExchange): Record<string, unknown> {
  return {
    direction: row.direction,
    date: row.date,
    status: row.status,
    publicTalkId: row.publicTalkId,
    visitingSpeakerId: row.visitingSpeakerId,
    speakerName: row.speakerName,
    speakerCongregation: row.speakerCongregation,
    hospitalityPublisherId: row.hospitalityPublisherId,
    publisherId: row.publisherId,
    hostCongregationId: row.hostCongregationId,
    note: row.note,
  };
}

/**
 * Как выглядит слот программы в журнале изменений.
 *
 * Те же поля, что записывает обычная правка назначения, плюс речь и связь со
 * справочником — их меняет именно замена, и без них запись в журнале не
 * позволила бы понять, что произошло.
 */
function slotSnapshot(row: Assignment): Record<string, unknown> {
  return {
    publisherId: row.publisherId ?? null,
    speakerName: row.speakerName ?? null,
    speakerCongregation: row.speakerCongregation ?? null,
    visitingSpeakerId: row.visitingSpeakerId ?? null,
    publicTalkId: row.publicTalkId ?? null,
    partTitle: row.partTitle ?? null,
  };
}

const SLOT_FIELDS = [
  'publisherId',
  'speakerName',
  'speakerCongregation',
  'visitingSpeakerId',
  'publicTalkId',
  'partTitle',
];

@Injectable()
export class TalkExchangeService {
  constructor(
    @InjectRepository(TalkExchange)
    private readonly repo: Repository<TalkExchange>,
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Absence)
    private readonly absenceRepo: Repository<Absence>,
    @InjectRepository(VisitingSpeaker)
    private readonly speakerRepo: Repository<VisitingSpeaker>,
    @InjectRepository(ExternalCongregation)
    private readonly congregationRepo: Repository<ExternalCongregation>,
    @InjectRepository(PublicTalk)
    private readonly publicTalkRepo: Repository<PublicTalk>,
    @InjectRepository(Responsibility)
    private readonly responsibilitiesRepo: Repository<Responsibility>,
    @InjectRepository(MeetingSettings)
    private readonly meetingSettingsRepo: Repository<MeetingSettings>,
    private readonly auditLog: AuditLogService,
  ) {}

  private static readonly MANAGER_RESPONSIBILITIES = [
    ResponsibilityType.PUBLIC_TALK_COORDINATOR,
    // У помощника те же права: замену делают перед встречей, и координатора
    // может не быть рядом.
    ResponsibilityType.PUBLIC_TALK_COORDINATOR_ASSISTANT,
  ];

  private async assertCanWrite(user: AuthenticatedUser): Promise<void> {
    if (user.role === UserRole.ADMIN) return;
    const held = await this.responsibilitiesRepo.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In(TalkExchangeService.MANAGER_RESPONSIBILITIES),
      },
    });
    if (held === 0) {
      throw new ForbiddenException(
        'Only the public talk coordinator or his assistant may edit the talk exchange',
      );
    }
  }

  findAll(tenantId: string): Promise<TalkExchange[]> {
    return this.repo.find({
      where: { congregationId: tenantId },
      order: { date: 'DESC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<TalkExchange> {
    const row = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!row) throw new NotFoundException('Talk exchange entry not found');
    return row;
  }

  async create(
    tenantId: string,
    dto: CreateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = this.repo.create({ ...fields, congregationId: tenantId });
    const saved = await this.repo.save(row);
    await this.auditLog.logCreate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      // Whom the entry concerns: our own speaker going out, or the publisher
      // hosting a visitor.
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      after: snapshot(saved),
    });
    return this.applySideEffects(tenantId, saved, overwriteProgram);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTalkExchangeDto,
    user: AuthenticatedUser,
  ): Promise<TalkExchangeResult> {
    await this.assertCanWrite(user);
    const { overwriteProgram, ...fields } = dto;
    const row = await this.findOne(tenantId, id);
    // Snapshot BEFORE Object.assign — the row is mutated in place.
    const before = snapshot(row);
    Object.assign(row, fields);
    const saved = await this.repo.save(row);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: saved.id,
      subjectId: saved.publisherId ?? saved.hospitalityPublisherId,
      before,
      after: snapshot(saved),
      fields: Object.keys(before),
    });
    return this.applySideEffects(tenantId, saved, overwriteProgram);
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
      entityType: 'talk_exchange',
      entityId: id,
      action: 'DELETE',
      subjectId: row.publisherId ?? row.hospitalityPublisherId,
      detail: snapshot(row),
    });
    // Remove the auto-created outgoing absence.
    if (row.linkedAbsenceId) {
      await this.absenceRepo.softDelete(row.linkedAbsenceId);
    }
    // Incoming is kept in sync with the program's public-talk slot: removing the
    // journal entry clears that slot (when it still reflects this visitor).
    if (row.direction === TalkExchangeDirection.INCOMING) {
      await this.clearProgramSlot(tenantId, row);
    }
    await this.repo.softDelete(row.id);
  }

  /** Clear the weekend public-talk slot if it still reflects an invited speaker. */
  /**
   * Кто это, если известно только имя.
   *
   * Имя — не личность. Один и тот же брат, записанный «Walter Getko»,
   * «Вальтер Гетко» и «Getko W.», для любого подсчёта три разных человека, и
   * история, собранная по написанию, врёт именно тогда, когда она нужна — в
   * минуту, когда решают, кого звать. Поэтому у каждого визита должна быть
   * карточка, даже если координатор просто напечатал имя в программе.
   *
   * Сопоставление СТРОГОЕ и только по двум признакам: то же имя без учёта
   * регистра и лишних пробелов И то же собрание (или у обоих собрания нет).
   * Совпало — берём существующую карточку. Не совпало — заводим новую, а не
   * приклеиваем визит к похожему: тёзки в собраниях обычны, и склеить двух
   * братьев молча хуже, чем завести лишнюю карточку, которую видно и можно
   * слить.
   *
   * Собрание ищется по названию и НЕ заводится само: список собраний — это
   * решение координатора, а не побочный итог опечатки в имени. Не нашли —
   * карточка живёт без собрания, название остаётся текстом в записи журнала.
   */
  private async speakerCardFor(
    tenantId: string,
    fullName: string,
    congregationName: string | null,
  ): Promise<string | null> {
    const name = fullName.trim().replace(/\s+/g, ' ');
    if (name === '') return null;

    const congName = congregationName?.trim() || null;
    // Сравнение в памяти, а не запросом: собраний у одного собрания десятки, а
    // не тысячи, зато правило совпадения — одно и то же и для имени, и для
    // названия, и его видно рядом.
    const externalId = congName
      ? ((
          await this.congregationRepo.find({
            where: { congregationId: tenantId },
          })
        ).find((c) => c.name.trim().toLowerCase() === congName.toLowerCase())
          ?.id ?? null)
      : null;

    const candidates = await this.speakerRepo.find({
      where: { congregationId: tenantId },
    });
    const same = candidates.find(
      (c) =>
        speakerFullName(c).trim().replace(/\s+/g, ' ').toLowerCase() ===
          name.toLowerCase() &&
        (c.externalCongregationId ?? null) === externalId,
    );
    if (same) return same.id;

    // Разделение имени на первое слово и остаток — то же, что делает
    // speakerFullName в обратную сторону, поэтому обратный проход по этой
    // карточке даст ровно исходную строку.
    const space = name.indexOf(' ');
    const firstName = space === -1 ? name : name.slice(0, space);
    const lastName = space === -1 ? null : name.slice(space + 1);

    const created = await this.speakerRepo.save(
      this.speakerRepo.create({
        congregationId: tenantId,
        firstName,
        lastName,
        externalCongregationId: externalId,
        /**
         * Заведена приложением, а не человеком. Признак нужен не для порядка:
         * у такой карточки нет ни телефона, ни репертуара, и на экране её
         * стоит показывать так, чтобы было видно — сюда можно дописать
         * сведения.
         */
        autoCreated: true,
      }),
    );
    return created.id;
  }

  private async clearProgramSlot(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate: mondayOf(entry.date),
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return;

    // A local brother in the slot used to stop this outright, on the reasoning
    // that he was not ours to wipe. That is right when SOMEONE ELSE put him
    // there — and wrong when this very entry did, which is what happens
    // whenever "our brother" is chosen: the entry writes slot.publisherId, and
    // then deleting the entry left him behind, still on the weekend programme.
    // So the test is not "is a brother assigned" but "is he the one this entry
    // assigned".
    const putHereByThisEntry =
      entry.publisherId != null && slot.publisherId === entry.publisherId;
    if (slot.publisherId && !putHereByThisEntry) return;
    if (!slot.publisherId && !slot.speakerName && !slot.publicTalkId) return;

    slot.publisherId = null;
    slot.speakerName = null;
    slot.speakerCongregation = null;
    slot.publicTalkId = null;
    slot.partTitle = null;
    if (slot.status === AssignmentStatus.PUBLISHED)
      slot.changedSincePublish = true;
    await this.assignmentRepo.save(slot);
  }

  // ---- Side effects -------------------------------------------------------

  private async applySideEffects(
    tenantId: string,
    entry: TalkExchange,
    overwriteProgram?: boolean,
  ): Promise<TalkExchangeResult> {
    if (entry.direction === TalkExchangeDirection.INCOMING) {
      return this.applyIncomingToProgram(
        tenantId,
        entry,
        overwriteProgram ?? false,
      );
    }
    if (entry.direction === TalkExchangeDirection.OUTGOING) {
      await this.syncOutgoingAbsence(tenantId, entry);
    }
    return entry;
  }

  /**
   * Fill the weekend public-talk slot for the entry's week with the visiting
   * speaker + talk. If the slot is already filled with something else and
   * overwrite is false, leave it and flag a conflict for the app to confirm.
   */
  private async applyIncomingToProgram(
    tenantId: string,
    entry: TalkExchange,
    overwrite: boolean,
  ): Promise<TalkExchangeResult> {
    if (!entry.publicTalkId) return entry;

    const localPublisherId = entry.publisherId ?? null;
    let name: string | null = null;
    let congName: string | null = null;
    if (!localPublisherId) {
      if (entry.visitingSpeakerId) {
        const speaker = await this.speakerRepo.findOne({
          where: { id: entry.visitingSpeakerId, congregationId: tenantId },
          relations: { externalCongregation: true },
        });
        if (speaker) {
          name = speakerFullName(speaker);
          congName = speaker.externalCongregation?.name ?? null;
        }
      }
      if (!name && entry.speakerName?.trim()) {
        name = entry.speakerName.trim();
        congName = entry.speakerCongregation?.trim() || null;
      }
      if (!name) return entry; // nothing to fill the slot with
    }

    const weekStartDate = mondayOf(entry.date);
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) return entry; // no weekend programme for that week yet

    const alreadyThis = localPublisherId
      ? slot.publisherId === localPublisherId &&
        slot.publicTalkId === entry.publicTalkId
      : slot.publicTalkId === entry.publicTalkId && slot.speakerName === name;
    const occupied = !!(
      slot.publisherId ||
      slot.publicTalkId ||
      slot.speakerName?.trim()
    );

    if (occupied && !overwrite && !alreadyThis) {
      const result = entry as TalkExchangeResult;
      result.programConflict = true;
      return result;
    }

    if (localPublisherId) {
      slot.publisherId = localPublisherId;
      slot.speakerName = null;
      slot.speakerCongregation = null;
      slot.visitingSpeakerId = null;
    } else {
      slot.publisherId = null;
      slot.speakerName = name;
      slot.speakerCongregation = congName;
      // Связь едет вместе с именем. Без неё обратное зеркало прочитает только
      // текст, не узнает записи журнала и сотрёт её привязку к карточке — как
      // и было до сих пор.
      slot.visitingSpeakerId = entry.visitingSpeakerId ?? null;
    }
    slot.publicTalkId = entry.publicTalkId;
    const talk = await this.publicTalkRepo.findOne({
      where: { id: entry.publicTalkId },
    });
    slot.partTitle = talk ? `№${talk.number}. ${talk.title}` : slot.partTitle;
    if (slot.status === AssignmentStatus.PUBLISHED) {
      slot.changedSincePublish = true;
    }
    await this.assignmentRepo.save(slot);
    return entry;
    return entry;
  }

  /**
   * Keep an absence in sync for an outgoing brother (he is away that day).
   * Creates on first sync, updates on change, removes if the brother is
   * cleared.
   */
  private async syncOutgoingAbsence(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<void> {
    if (!entry.publisherId) {
      if (entry.linkedAbsenceId) {
        await this.absenceRepo.softDelete(entry.linkedAbsenceId);
        entry.linkedAbsenceId = null;
        await this.repo.save(entry);
      }
      return;
    }

    const note = await this.buildOutgoingNote(tenantId, entry);

    if (entry.linkedAbsenceId) {
      const abs = await this.absenceRepo.findOne({
        where: { id: entry.linkedAbsenceId, congregationId: tenantId },
      });
      if (abs) {
        abs.publisherId = entry.publisherId;
        abs.startDate = entry.date;
        abs.endDate = null;
        abs.note = note;
        await this.absenceRepo.save(abs);
        return;
      }
    }

    const abs = this.absenceRepo.create({
      congregationId: tenantId,
      publisherId: entry.publisherId,
      startDate: entry.date,
      note: note ?? undefined,
    });
    const savedAbs = await this.absenceRepo.save(abs);
    entry.linkedAbsenceId = savedAbs.id;
    await this.repo.save(entry);
  }

  private async buildOutgoingNote(
    tenantId: string,
    entry: TalkExchange,
  ): Promise<string | null> {
    const parts: string[] = [];
    if (entry.publicTalkId) {
      const talk = await this.publicTalkRepo.findOne({
        where: { id: entry.publicTalkId },
      });
      if (talk) parts.push(`№${talk.number}`);
    }
    if (entry.hostCongregationId) {
      const cong = await this.congregationRepo.findOne({
        where: { id: entry.hostCongregationId, congregationId: tenantId },
      });
      if (cong) parts.push(cong.name);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  // ---- Program -> Journal sync -------------------------------------------

  /** The weekend meeting date for a week, per the meeting-settings version in force. */
  private async weekendDateFor(
    tenantId: string,
    weekStartDate: string,
  ): Promise<string> {
    const version = await this.meetingSettingsRepo.findOne({
      where: { congregationId: tenantId },
      order: { effectiveFrom: 'DESC' },
    });
    const dow = version?.weekendDow ?? 7; // default Sunday
    return addDaysISO(weekStartDate, dow - 1);
  }

  /**
   * Build the journal from the programme, for every week from a date onwards.
   *
   * The two-way sync began on 23 June 2026. Weekend speakers entered BEFORE
   * that day never produced a journal entry — nothing was deleted, the mirror
   * simply did not exist yet. From the coordinator's chair that reads as data
   * lost, and it is worse than lost: the programme says a brother came and the
   * journal says nobody did.
   *
   * Idempotent by construction: it calls the same one-week sync used
   * everywhere else, so a week that already agrees is left exactly as it is.
   */
  async rebuildFromProgramme(
    tenantId: string,
    from: string,
  ): Promise<{ weeks: number; created: number; linked: number }> {
    const slots = await this.assignmentRepo.find({
      where: {
        congregationId: tenantId,
        partKey: PUBLIC_TALK_PART_KEY,
        weekStartDate: MoreThanOrEqual(from),
      },
      order: { weekStartDate: 'ASC' },
    });

    /**
     * Считаем ДВА разных исхода, потому что раньше считали ни одного.
     *
     * Прежняя мерка была разницей количеств до и после, а под ней стояла
     * подпись «если ничего не добавилось — значит журнал и программа уже
     * совпадают». В первый же настоящий прогон это оказалось неправдой:
     * записей не прибавилось ни одной, зато четыре визита впервые обрели
     * хозяина — связь со справочником проставилась там, где её не было. Про
     * это человеку не сказали ничего.
     *
     * Разница количеств не умеет отличить «ничего не произошло» от «поровну
     * появилось и исчезло» и вовсе слепа к изменениям внутри записи. Поэтому
     * теперь смотрим на состояние записей: сколько было и у скольких была
     * связь.
     */
    const whereIncoming = {
      congregationId: tenantId,
      direction: TalkExchangeDirection.INCOMING,
      date: MoreThanOrEqual(from),
    };
    const before = await this.repo.find({ where: whereIncoming });
    const linkedBefore = new Set(
      before.filter((e) => e.visitingSpeakerId).map((e) => e.id),
    );

    const weeks = [...new Set(slots.map((a) => a.weekStartDate))];
    for (const week of weeks) {
      await this.syncProgramToJournal(tenantId, week);
    }

    const after = await this.repo.find({ where: whereIncoming });
    const created = Math.max(0, after.length - before.length);
    // Связанные заново — те, у кого связь появилась, а запись существовала и
    // раньше. Новые записи со связью считаются в `created`, дважды одно и то
    // же событие называть незачем.
    const linked = after.filter(
      (e) =>
        e.visitingSpeakerId &&
        linkedBefore.has(e.id) === false &&
        before.some((b) => b.id === e.id),
    ).length;

    return { weeks: weeks.length, created, linked };
  }

  /**
   * Приехал другой брат.
   *
   * Это не правка записи, а два факта: визит того, кого ждали, НЕ СОСТОЯЛСЯ, а
   * визит того, кто приехал, состоялся. Раньше оба умещались в одну строку —
   * имя переписывали, и первый брат исчезал бесследно: ни следа, что его звали
   * и он не приехал. А по этому следу и решают, звать ли снова.
   *
   * Делается одним действием, потому что делается со сцены. Председатель
   * объявляет то, что написано в программе, и правка в двух местах подряд в
   * эту минуту невозможна: программа должна стать верной сразу.
   *
   * Порядок важен: сперва закрываем прежнюю запись, и только потом зеркало
   * заводит новую. Иначе оно нашло бы старую и переписало её именем нового —
   * ровно та потеря истории, ради которой всё делалось.
   */
  async replaceSpeaker(
    tenantId: string,
    user: AuthenticatedUser,
    dto: ReplaceSpeakerDto,
  ): Promise<{ closed: string | null; entry: TalkExchange | null }> {
    await this.assertCanWrite(user);

    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate: dto.weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (!slot) {
      throw new NotFoundException('That week has no public-talk slot');
    }
    // Снимок до правки: снимается здесь, пока слот ещё не тронут.
    const slotWas = { ...slot } as Assignment;

    const weekEnd = addDaysISO(dto.weekStartDate, 6);
    const previous = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(dto.weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });

    /**
     * Замена на того же самого — не замена.
     *
     * Нажать можно случайно, а последствие тяжёлое: живой визит закрылся бы
     * как несостоявшийся и тут же завёлся заново, оставив в истории брата
     * ложную отметку «не приехал».
     */
    const sameSpeaker =
      (dto.visitingSpeakerId &&
        dto.visitingSpeakerId === slot.visitingSpeakerId) ||
      (dto.publisherId && dto.publisherId === slot.publisherId);
    if (sameSpeaker) {
      throw new BadRequestException({
        code: 'SAME_SPEAKER',
        message: 'That speaker already has this week',
      });
    }

    let closed: string | null = null;
    /**
     * Закрываем визит любого — и приезжего, и НАШЕГО брата.
     *
     * Сначала было иначе: считалось, что про своего «не состоялось» говорить
     * нечего, он ведь никуда не ездил. Это оказалось неверно дважды. По сути:
     * «наш брат не смог, вместо него другой» бывает не реже приезда гостя, и
     * это ровно тот же факт — назначен и не выступил. По последствиям хуже:
     * без закрытой записи нечего возвращать, и замена на такой неделе
     * становилась необратимой. Именно так 7 сентября неделя с Коршудьянцем
     * потеряла и докладчика, и тему, и восстанавливать пришлось из резервной
     * копии.
     */
    if (previous) {
      const beforeState = snapshot(previous);
      previous.status = TalkExchangeStatus.DID_NOT_HAPPEN;
      if (dto.reason?.trim()) {
        previous.note = [previous.note, dto.reason.trim()]
          .filter(Boolean)
          .join(' · ');
      }
      await this.repo.save(previous);
      closed = previous.id;
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'talk_exchange',
        entityId: previous.id,
        subjectId: previous.publisherId ?? previous.hospitalityPublisherId,
        before: beforeState,
        after: snapshot(previous),
        fields: ['status', 'note'],
      });
    }

    // Новый докладчик занимает слот программы — с этой секунды председатель
    // читает верное имя.
    const name = dto.speakerName?.trim() || null;
    if (dto.visitingSpeakerId) {
      const speaker = await this.speakerRepo.findOne({
        where: { id: dto.visitingSpeakerId, congregationId: tenantId },
        relations: { externalCongregation: true },
      });
      if (!speaker) throw new NotFoundException('Speaker not found');
      slot.publisherId = null;
      slot.visitingSpeakerId = speaker.id;
      slot.speakerName = speakerFullName(speaker);
      slot.speakerCongregation = speaker.externalCongregation?.name ?? null;
    } else if (dto.publisherId) {
      slot.publisherId = dto.publisherId;
      slot.visitingSpeakerId = null;
      slot.speakerName = null;
      slot.speakerCongregation = null;
    } else if (name) {
      slot.publisherId = null;
      // Карточка заводится или находится здесь же: визит нового брата обязан
      // попасть в его историю так же, как и любой другой.
      slot.visitingSpeakerId = await this.speakerCardFor(
        tenantId,
        name,
        dto.speakerCongregation ?? null,
      );
      slot.speakerName = name;
      slot.speakerCongregation = dto.speakerCongregation?.trim() || null;
    } else {
      throw new BadRequestException('Nobody to put in the slot');
    }
    /**
     * Речь меняется вместе с докладчиком — если её назвали.
     *
     * Приезжает другой брат со своей речью, и до сих пор слот молча сохранял
     * прежний номер: новому записывалось то, чего он не говорил, а подсказка
     * «эта речь у нас уже была» начинала отговаривать от темы, которую никто
     * не слышал. Не назвали — оставляем как есть: тот же доклад может читать
     * другой, и это законный случай.
     */
    if (dto.publicTalkId) {
      slot.publicTalkId = dto.publicTalkId;
      const talk = await this.publicTalkRepo.findOne({
        where: { id: dto.publicTalkId },
      });
      if (talk) slot.partTitle = `№${talk.number}. ${talk.title}`;
    }
    if (slot.status === AssignmentStatus.PUBLISHED) {
      slot.changedSincePublish = true;
    }
    const slotBefore = slotSnapshot(slotWas);
    await this.assignmentRepo.save(slot);
    /**
     * След в журнале изменений.
     *
     * Обычная правка назначения его оставляет, а замена правила слот напрямую
     * и молча — поэтому у испорченной недели не нашлось ни следа, ни
     * возможности вернуть как было. Действие, меняющее программу, обязано
     * говорить, кто и что изменил.
     */
    await this.auditLog.logUpdate({
      tenantId: tenantId,
      entityType: 'assignment',
      entityId: slot.id,
      subjectId: slot.publisherId ?? null,
      before: slotBefore,
      after: slotSnapshot(slot),
      fields: SLOT_FIELDS,
    });

    // Зеркало заводит запись нового визита. Прежняя ему уже не видна.
    await this.syncProgramToJournal(tenantId, dto.weekStartDate);

    const entry = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(dto.weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });

    /**
     * Гостеприимство переезжает к тому, кто приехал.
     *
     * Решение Лионеля: семье всё равно, какого докладчика принимать — она
     * принимает ГОСТЯ ЭТОЙ НЕДЕЛИ. Оставить приём у несостоявшегося визита
     * значило бы, что приехавшего никто не встречает, а семья об этом узнаёт
     * в лучшем случае в зале.
     */
    if (
      previous?.hospitalityPublisherId &&
      entry &&
      !entry.hospitalityPublisherId
    ) {
      entry.hospitalityPublisherId = previous.hospitalityPublisherId;
      await this.repo.save(entry);
      previous.hospitalityPublisherId = null;
      await this.repo.save(previous);
    }

    return { closed, entry };
  }

  /**
   * Он всё-таки приехал — или на кнопку нажали по ошибке.
   *
   * Замена оставляет в истории отметку «назначался, не приехал», и это верно
   * ровно до тех пор, пока она правда. Ошибиться легко: замену делают в спешке
   * перед встречей, иногда с чужого телефона, иногда не с тем братом в списке.
   * Без возврата у человека остаётся ложное пятно, стереть которое нечем — а
   * по нему решают, звать ли его снова.
   *
   * Возвращаем ровно то, что замена изменила: закрытая запись снова
   * состоявшаяся, слот программы снова его, а запись заменившего убирается —
   * НО только если она пуста от собственной работы координатора. Если к ней
   * успели приписать гостеприимство, заметку или назначить своего докладчика,
   * решать за него нельзя: тогда обе записи остаются, и человек разбирается
   * сам, видя обе.
   */
  async undoReplacement(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ restored: string; removed: string | null }> {
    await this.assertCanWrite(user);

    const closed = await this.repo.findOne({
      where: { id, congregationId: tenantId },
    });
    if (!closed) throw new NotFoundException('Entry not found');
    if (closed.status !== TalkExchangeStatus.DID_NOT_HAPPEN) {
      throw new BadRequestException({
        code: 'NOT_A_MISSED_VISIT',
        message: 'Only a visit marked as not happened can be undone',
      });
    }

    const weekStartDate = mondayOf(closed.date);
    const weekEnd = addDaysISO(weekStartDate, 6);

    // Запись, которая сейчас занимает неделю: её завела замена.
    const live = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });
    /**
     * Своя работа координатора — только заметка.
     *
     * Гостеприимство сюда не входит намеренно: оно принадлежит НЕДЕЛЕ, а не
     * человеку (семья принимает гостя, кем бы он ни был), и при замене
     * переезжает вместе с ней. Значит при возврате оно едет обратно, а не
     * держит запись заменившего на месте.
     */
    const liveHasOwnWork = !!live && !!live.note;

    const before = snapshot(closed);
    closed.status = TalkExchangeStatus.CONFIRMED;
    await this.repo.save(closed);
    await this.auditLog.logUpdate({
      tenantId,
      entityType: 'talk_exchange',
      entityId: closed.id,
      subjectId: closed.publisherId ?? closed.hospitalityPublisherId,
      before,
      after: snapshot(closed),
      fields: ['status'],
    });

    let removed: string | null = null;
    if (live && !liveHasOwnWork) {
      if (live.hospitalityPublisherId && !closed.hospitalityPublisherId) {
        closed.hospitalityPublisherId = live.hospitalityPublisherId;
        await this.repo.save(closed);
      }
      await this.repo.softDelete(live.id);
      removed = live.id;
    }

    // Программа возвращается к нему: председатель снова прочитает верное имя.
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });
    if (slot) {
      const slotBefore = slotSnapshot(slot);
      slot.publisherId = closed.publisherId ?? null;
      slot.visitingSpeakerId = closed.visitingSpeakerId ?? null;
      slot.speakerName = closed.publisherId ? null : closed.speakerName;
      slot.speakerCongregation = closed.publisherId
        ? null
        : closed.speakerCongregation;
      if (closed.publicTalkId) {
        slot.publicTalkId = closed.publicTalkId;
        const talk = await this.publicTalkRepo.findOne({
          where: { id: closed.publicTalkId },
        });
        if (talk) slot.partTitle = `№${talk.number}. ${talk.title}`;
      }
      if (slot.status === AssignmentStatus.PUBLISHED) {
        slot.changedSincePublish = true;
      }
      await this.assignmentRepo.save(slot);
      await this.auditLog.logUpdate({
        tenantId,
        entityType: 'assignment',
        entityId: slot.id,
        subjectId: slot.publisherId ?? null,
        before: slotBefore,
        after: slotSnapshot(slot),
        fields: SLOT_FIELDS,
      });
    }

    return { restored: closed.id, removed };
  }

  /**
   * Keep the journal's incoming entry in sync with the program's weekend
   * public-talk slot for a week. Only invited speakers (free-text speakerName,
   * no local publisher) map to a "К нам" entry. Called after the schedule edits
   * a public_talk_speaker assignment. Writes directly (no further side effects)
   * and is idempotent, so it never loops with applyIncomingToProgram.
   */
  async syncProgramToJournal(
    tenantId: string,
    weekStartDate: string,
  ): Promise<void> {
    const slot = await this.assignmentRepo.findOne({
      where: {
        congregationId: tenantId,
        weekStartDate,
        partKey: PUBLIC_TALK_PART_KEY,
      },
    });

    // Find the existing incoming journal entry for this week (if any).
    const weekEnd = addDaysISO(weekStartDate, 6);
    /**
     * Запись, которую зеркало ведёт, — только СОСТОЯВШАЯСЯ.
     *
     * После замены в неделе лежат две: несостоявшийся визит первого брата и
     * визит второго. Если бы зеркало могло выбрать любую, оно рано или поздно
     * переписало бы историю первого именем второго — и потеря, ради устранения
     * которой всё затевалось, вернулась бы с другой стороны.
     */
    const existing = await this.repo.findOne({
      where: {
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: Between(weekStartDate, weekEnd),
        status: Not(TalkExchangeStatus.DID_NOT_HAPPEN),
      },
    });

    // A cancelled week (congress, memorial, ...) counts as "no speaker":
    // its journal entry must not survive the cancellation.
    const active = slot && slot.status !== AssignmentStatus.CANCELLED;
    const hasLocal = !!(active && slot.publisherId);
    const hasInvited = !!(
      active &&
      !slot.publisherId &&
      slot.speakerName?.trim()
    );

    if (!hasLocal && !hasInvited) {
      /**
       * The programme has nobody for that weekend.
       *
       * A cancelled week means the entry should go — the meeting is not
       * happening. But an EMPTY slot means «ещё не заполнили», and an entry
       * carrying the coordinator's own work — a note, a host family, a named
       * visiting speaker — must not be thrown away because the programme has
       * not caught up yet. That would be the application undoing arrangements
       * it did not make.
       */
      const cancelled = !!slot && slot.status === AssignmentStatus.CANCELLED;
      const coordinatorsOwn =
        !!existing &&
        (!!existing.visitingSpeakerId ||
          !!existing.hospitalityPublisherId ||
          !!existing.note);
      if (existing && (cancelled || !coordinatorsOwn)) {
        await this.repo.softDelete(existing.id);
      }
      return;
    }

    const publicTalkId = slot!.publicTalkId ?? null;

    if (hasLocal) {
      const publisherId = slot!.publisherId!;
      if (existing) {
        const same =
          existing.publisherId === publisherId &&
          existing.visitingSpeakerId == null &&
          existing.speakerName == null &&
          existing.publicTalkId === publicTalkId;
        if (same) return;
        existing.publisherId = publisherId;
        // Наш брат — не приезжий: связь со справочником снимается намеренно.
        existing.visitingSpeakerId = null;
        existing.speakerName = null;
        existing.speakerCongregation = null;
        existing.publicTalkId = publicTalkId;
        await this.repo.save(existing);
        return;
      }
      const entry = this.repo.create({
        congregationId: tenantId,
        direction: TalkExchangeDirection.INCOMING,
        date: await this.weekendDateFor(tenantId, weekStartDate),
        publisherId,
        publicTalkId,
      });
      await this.repo.save(entry);
      return;
    }

    const speakerName = slot!.speakerName!.trim();
    const speakerCongregation = slot!.speakerCongregation?.trim() || null;

    /**
     * Чей это визит.
     *
     * Слот теперь может нести связь сам; если не несёт — значит имя напечатали
     * руками, и карточку надо найти или завести. Раньше здесь просто ставился
     * null, и ровно в этой строке визит переставал принадлежать человеку.
     */
    const visitingSpeakerId =
      slot!.visitingSpeakerId ??
      (await this.speakerCardFor(tenantId, speakerName, speakerCongregation));

    // Слот, в котором имя было напечатано руками, дальше несёт найденную
    // карточку — иначе на каждое сохранение недели заводилась бы новая.
    if (visitingSpeakerId && !slot!.visitingSpeakerId) {
      slot!.visitingSpeakerId = visitingSpeakerId;
      await this.assignmentRepo.save(slot!);
    }

    if (existing) {
      const same =
        existing.publisherId == null &&
        existing.visitingSpeakerId === visitingSpeakerId &&
        existing.speakerName === speakerName &&
        existing.speakerCongregation === speakerCongregation &&
        existing.publicTalkId === publicTalkId;
      if (same) return; // idempotent: nothing changed
      existing.publisherId = null;
      existing.visitingSpeakerId = visitingSpeakerId;
      existing.speakerName = speakerName;
      existing.speakerCongregation = speakerCongregation;
      existing.publicTalkId = publicTalkId;
      await this.repo.save(existing);
      return;
    }

    const entry = this.repo.create({
      congregationId: tenantId,
      direction: TalkExchangeDirection.INCOMING,
      date: await this.weekendDateFor(tenantId, weekStartDate),
      visitingSpeakerId,
      speakerName,
      speakerCongregation,
      publicTalkId,
    });
    await this.repo.save(entry);
  }
}
