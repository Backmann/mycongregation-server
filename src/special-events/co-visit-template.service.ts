import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { mondayOf } from '../common/week';
import { addDaysISO } from '../common/week-rules';

/** The special-event `type` that drives the circuit-overseer program template. */
export const CIRCUIT_OVERSEER_VISIT_TYPE = 'circuit_overseer_visit';

/** Part keys the template introduces (rendered/localized by the app). */
export const CO_SERVICE_TALK_KEY = 'co_service_talk';
export const CO_CONCLUDING_TALK_KEY = 'co_concluding_talk';

const SERVICE_TALK_DURATION_MIN = 30;
const CONCLUDING_TALK_DURATION_MIN = 30;
const WATCHTOWER_VISIT_DURATION_MIN = 30;

// Midweek: the Congregation Bible Study is replaced by the service talk —
// the study + its reader are hidden (soft-deleted), not shown cancelled.
const MIDWEEK_HIDE_KEYS = ['cbs_conductor', 'cbs_reader'];
// Weekend: the Watchtower study drops its reader; CO gives public + concluding talks.
const WEEKEND_HIDE_KEYS = ['watchtower_reader'];
const WT_CONDUCTOR_KEY = 'watchtower_conductor';
const WT_READER_KEY = 'watchtower_reader';
const PUBLIC_TALK_KEY = 'public_talk_speaker';
const CBS_CONDUCTOR_KEY = 'cbs_conductor';

// Closing song lives inside the closing-prayer title (e.g. "Песня 60 и
// молитва"). For a visit the overseer picks it himself, so we surface a
// separate, selectable song row and clear the song off the prayer.
const MIDWEEK_CLOSING_PRAYER_KEY = 'midweek_closing_prayer';
const WEEKEND_CLOSING_PRAYER_KEY = 'weekend_closing_prayer';
const MIDWEEK_SONG_KEY = 'mid_song';
const WEEKEND_SONG_KEY = 'weekend_song';

/**
 * One undoable change made by the template. Stored on the event so deleting it
 * restores the meeting exactly: cancelled parts get their prior status back,
 * mutated fields get their prior value, and added parts are removed.
 */
type RevertOp =
  | { op: 'status'; id: string; prev: AssignmentStatus }
  | {
      op: 'field';
      id: string;
      field: 'partDurationMin' | 'speakerName' | 'partTitle';
      prev: number | string | null;
    }
  | { op: 'added'; id: string }
  | { op: 'deleted'; id: string }
  /**
   * Not a change: a note that this meeting of the week has had the template.
   *
   * The two meetings of a visit week are not always loaded together — the
   * workbook comes first, the weekend is created later, sometimes months
   * apart. The template used to run once, at the moment the visit was saved,
   * and a meeting loaded after that never got it: no service talk, the study
   * still in place. With a mark per meeting the template can be offered again
   * whenever the week gains a meeting, and do only what is still missing.
   */
  | { op: 'meeting'; kind: MeetingKindKey };

type MeetingKindKey = 'midweek' | 'weekend';

function coDisplayName(event: SpecialEvent): string | null {
  const name = [event.coFirstName, event.coLastName]
    .filter((p) => p && p.trim())
    .join(' ')
    .trim();
  return name.length > 0 ? name : null;
}

@Injectable()
export class CoVisitTemplateService {
  private readonly logger = new Logger(CoVisitTemplateService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(SpecialEvent)
    private readonly eventRepo: Repository<SpecialEvent>,
    private readonly clock: CongregationClock,
  ) {}

  /**
   * Whether the visit's week is behind us, by the congregation's own clock.
   *
   * A week that has been held is history: its programme is what was said on
   * the day. Entering an old visit for the record, deleting one, moving one —
   * none of it may rewrite that programme. Judged by the END of the week, as
   * the swap of talks is: on Sunday morning the week is still running.
   */
  async weekIsOver(event: Pick<SpecialEvent, 'congregationId' | 'date'>) {
    const today = await this.clock.todayFor(event.congregationId);
    return addDaysISO(mondayOf(event.date), 6) < today;
  }

  /**
   * Offers the template to every visit of this week — called whenever a
   * meeting of a week is created or imported, so a visit saved before the
   * programme existed still gets it. Does nothing in a week without a visit.
   */
  async applyForWeek(congregationId: string, week: string): Promise<void> {
    const visits = await this.eventRepo.find({
      where: {
        congregationId,
        type: CIRCUIT_OVERSEER_VISIT_TYPE,
        deletedAt: IsNull(),
      },
    });
    for (const v of visits) {
      if (mondayOf(v.date) !== week) continue;
      try {
        await this.apply(v);
      } catch (e) {
        // The import that called us has done its own work; failing it for the
        // visit would lose that too. Loud in the log, and the next import or
        // save of the visit offers the template again.
        this.logger.error(
          `CO visit ${v.id}: template for week ${week} failed: ${
            (e as Error).message
          }`,
        );
      }
    }
  }

  /**
   * Which meetings already have the template. New visits carry a mark per
   * meeting; one saved before the marks existed is read from the rows its
   * changes touched.
   */
  private async appliedKinds(
    em: EntityManager,
    ops: RevertOp[],
  ): Promise<Set<MeetingKindKey>> {
    const kinds = new Set<MeetingKindKey>();
    const marks = ops.filter(
      (o): o is { op: 'meeting'; kind: MeetingKindKey } => o.op === 'meeting',
    );
    if (marks.length > 0 || ops.length === 0) {
      for (const m of marks) kinds.add(m.kind);
      return kinds;
    }
    const ids = ops
      .filter((o) => o.op !== 'meeting')
      .map((o) => (o as { id: string }).id);
    const rows = await em.getRepository(Assignment).find({
      where: { id: In(ids) },
      withDeleted: true,
    });
    for (const r of rows) {
      if (r.eventType === EventType.MIDWEEK) kinds.add('midweek');
      if (r.eventType === EventType.WEEKEND) kinds.add('weekend');
    }
    return kinds;
  }

  /**
   * Applies the circuit-overseer program to the visit week (midweek + weekend)
   * and records the undo plan on the event. Each meeting is done once — a
   * meeting that has the template is not touched again — and only when its
   * programme exists (otherwise we'd create orphan talks in an empty week);
   * a meeting loaded later gets it through {@link applyForWeek}. A week that
   * is over is never touched: its programme is history.
   */
  async apply(event: SpecialEvent): Promise<SpecialEvent> {
    if (event.type !== CIRCUIT_OVERSEER_VISIT_TYPE) return event;
    if (event.deletedAt) return event;
    if (await this.weekIsOver(event)) return event;

    const week = mondayOf(event.date);
    const speaker = coDisplayName(event);

    return this.assignmentRepo.manager.transaction(async (em) => {
      const aRepo = em.getRepository(Assignment);
      const eRepo = em.getRepository(SpecialEvent);
      const before = ((event.coRevertData as RevertOp[] | null) ?? []).slice();
      const ops: RevertOp[] = before.slice();
      const applied = await this.appliedKinds(em, before);
      // A visit saved before the marks existed: record what it already has,
      // so the next offer does not do it a second time.
      if (!before.some((o) => o.op === 'meeting')) {
        for (const k of applied) ops.push({ op: 'meeting', kind: k });
      }

      const loadMeeting = (eventType: EventType) =>
        aRepo.find({
          where: {
            congregationId: event.congregationId,
            weekStartDate: week,
            eventType,
          },
        });

      const hidePart = async (a: Assignment) => {
        ops.push({ op: 'deleted', id: a.id });
        await aRepo.softDelete(a.id);
      };
      const setField = async (
        a: Assignment,
        field: 'partDurationMin' | 'speakerName' | 'partTitle',
        value: number | string | null,
      ) => {
        ops.push({ op: 'field', id: a.id, field, prev: a[field] });
        if (field === 'partDurationMin') {
          a.partDurationMin = value as number | null;
        } else if (field === 'speakerName') {
          a.speakerName = value as string | null;
        } else {
          a.partTitle = value as string | null;
        }
        await aRepo.save(a);
      };
      // Adds a selectable (empty) closing-song row before the closing prayer
      // and clears the song off the prayer, so the overseer's chosen song can
      // be picked from the list rather than read from the EPUB.
      const addClosingSong = async (
        eventType: EventType,
        songKey: string,
        prayer: Assignment,
      ) => {
        const songRow = aRepo.create({
          congregationId: event.congregationId,
          weekStartDate: week,
          eventType,
          partKey: songKey,
          partOrder: prayer.partOrder - 1,
          partTitle: null,
          partDurationMin: null,
          speakerName: null,
          status: AssignmentStatus.DRAFT,
        });
        const savedSong = await aRepo.save(songRow);
        ops.push({ op: 'added', id: savedSong.id });
        if (prayer.partTitle) {
          await setField(prayer, 'partTitle', null);
        }
      };

      // ---- Midweek: CBS -> 30-min service talk by the CO ----
      const midweek = await loadMeeting(EventType.MIDWEEK);
      if (applied.has('midweek')) {
        // Already has it — but a workbook imported again brings the study
        // back as a fresh row. While the visit stands, it stays hidden.
        await this.foldStrays(em, midweek, MIDWEEK_HIDE_KEYS, ops, hidePart);
      } else if (midweek.length > 0) {
        const byKey = new Map(midweek.map((a) => [a.partKey, a]));
        const cbs = byKey.get(CBS_CONDUCTOR_KEY);
        const maxOrder = Math.max(0, ...midweek.map((a) => a.partOrder));
        for (const key of MIDWEEK_HIDE_KEYS) {
          const a = byKey.get(key);
          if (a) await hidePart(a);
        }
        const serviceTalk = aRepo.create({
          congregationId: event.congregationId,
          weekStartDate: week,
          eventType: EventType.MIDWEEK,
          partKey: CO_SERVICE_TALK_KEY,
          partOrder: cbs ? cbs.partOrder : maxOrder + 1,
          partTitle: null,
          partDurationMin: SERVICE_TALK_DURATION_MIN,
          speakerName: speaker,
          status: AssignmentStatus.DRAFT,
        });
        const saved = await aRepo.save(serviceTalk);
        ops.push({ op: 'added', id: saved.id });

        const closingPrayer = byKey.get(MIDWEEK_CLOSING_PRAYER_KEY);
        if (closingPrayer) {
          await addClosingSong(
            EventType.MIDWEEK,
            MIDWEEK_SONG_KEY,
            closingPrayer,
          );
        }
        ops.push({ op: 'meeting', kind: 'midweek' });
      }

      // ---- Weekend: CO public talk, 30-min WT study (no reader), concluding talk ----
      const weekend = await loadMeeting(EventType.WEEKEND);
      if (applied.has('weekend')) {
        await this.foldStrays(em, weekend, WEEKEND_HIDE_KEYS, ops, hidePart);
      } else if (weekend.length > 0) {
        const byKey = new Map(weekend.map((a) => [a.partKey, a]));
        const wtConductor = byKey.get(WT_CONDUCTOR_KEY);
        const reader = byKey.get(WT_READER_KEY);
        const maxOrder = Math.max(0, ...weekend.map((a) => a.partOrder));
        const concludingOrder = reader
          ? reader.partOrder
          : wtConductor
            ? wtConductor.partOrder + 1
            : maxOrder + 1;

        for (const key of WEEKEND_HIDE_KEYS) {
          const a = byKey.get(key);
          if (a) await hidePart(a);
        }
        if (wtConductor) {
          await setField(
            wtConductor,
            'partDurationMin',
            WATCHTOWER_VISIT_DURATION_MIN,
          );
        }
        const publicTalk = byKey.get(PUBLIC_TALK_KEY);
        if (publicTalk && speaker) {
          await setField(publicTalk, 'speakerName', speaker);
        }
        const concludingTalk = aRepo.create({
          congregationId: event.congregationId,
          weekStartDate: week,
          eventType: EventType.WEEKEND,
          partKey: CO_CONCLUDING_TALK_KEY,
          partOrder: concludingOrder,
          partTitle: null,
          partDurationMin: CONCLUDING_TALK_DURATION_MIN,
          speakerName: speaker,
          status: AssignmentStatus.DRAFT,
        });
        const saved = await aRepo.save(concludingTalk);
        ops.push({ op: 'added', id: saved.id });

        const closingPrayer = byKey.get(WEEKEND_CLOSING_PRAYER_KEY);
        if (closingPrayer) {
          await addClosingSong(
            EventType.WEEKEND,
            WEEKEND_SONG_KEY,
            closingPrayer,
          );
        }
        ops.push({ op: 'meeting', kind: 'weekend' });
      }

      if (ops.length === before.length) {
        return event; // nothing new for this week
      }
      event.coRevertData = ops;
      const persisted = await eRepo.save(event);
      this.logger.log(
        `CO visit ${event.id}: template on week ${week} (${
          ops.length - before.length
        } new entries)`,
      );
      return persisted;
    });
  }

  /**
   * The parts a visit replaces, come back as new rows.
   *
   * The imports look only at the rows that are showing, so a workbook loaded
   * again into a visit week does not see the study the visit hid and creates
   * a second one. Hiding that one too would be half right: taking the visit
   * away later brings BOTH back, and the week has two studies. So a returning
   * part is folded into the one the visit hid — its new title and length go
   * onto that row if nobody was assigned there yet — and the duplicate is
   * removed. With nothing hidden to fold into, it is hidden as the first was.
   */
  private async foldStrays(
    em: EntityManager,
    rows: Assignment[],
    keys: string[],
    ops: RevertOp[],
    hidePart: (a: Assignment) => Promise<void>,
  ): Promise<void> {
    const strays = rows.filter((a) => keys.includes(a.partKey));
    if (strays.length === 0) return;
    const aRepo = em.getRepository(Assignment);
    const hiddenIds = ops
      .filter((o): o is { op: 'deleted'; id: string } => o.op === 'deleted')
      .map((o) => o.id);
    const hidden = hiddenIds.length
      ? await aRepo.find({ where: { id: In(hiddenIds) }, withDeleted: true })
      : [];
    for (const stray of strays) {
      const original = hidden.find(
        (h) =>
          !!h.deletedAt &&
          h.partKey === stray.partKey &&
          h.eventType === stray.eventType,
      );
      if (!original) {
        await hidePart(stray);
        continue;
      }
      if (!original.publisherId && !original.assistantPublisherId) {
        original.partTitle = stray.partTitle ?? original.partTitle;
        original.partDurationMin =
          stray.partDurationMin ?? original.partDurationMin;
        original.partOrder = stray.partOrder;
        await aRepo.save(original);
      }
      await aRepo.delete({ id: stray.id });
    }
  }

  /**
   * Re-points the visiting overseer's name on the talks he gives, after the
   * event's names change (picker / edit form). Only the template-managed
   * speaker parts are touched; the rest of the programme is left alone. No-op
   * unless the template has already been applied to this visit.
   */
  /** Public helper: the overseer's display name for an event (or null). */
  displayName(event: SpecialEvent): string | null {
    return coDisplayName(event);
  }

  async syncSpeaker(
    event: SpecialEvent,
    prevName: string | null,
  ): Promise<void> {
    if (event.type !== CIRCUIT_OVERSEER_VISIT_TYPE) return;
    const ops = (event.coRevertData as RevertOp[] | null) ?? [];
    if (ops.length === 0) return;

    const newName = coDisplayName(event);
    const week = mondayOf(event.date);

    // The talks the overseer always gives — forced to the current name so a
    // visit that drifted (name changed without a re-sync) is repaired.
    const managed = await this.assignmentRepo.find({
      where: {
        congregationId: event.congregationId,
        weekStartDate: week,
        partKey: In([
          CO_SERVICE_TALK_KEY,
          CO_CONCLUDING_TALK_KEY,
          PUBLIC_TALK_KEY,
        ]),
      },
    });
    // Plus anything else in the week still showing the previous overseer (e.g.
    // a prayer the user marked CO-led), renamed to the new overseer.
    const renamed =
      prevName && prevName !== newName
        ? await this.assignmentRepo.find({
            where: {
              congregationId: event.congregationId,
              weekStartDate: week,
              speakerName: prevName,
            },
          })
        : [];

    const seen = new Set<string>();
    for (const a of [...managed, ...renamed]) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      if (a.speakerName !== newName) {
        a.speakerName = newName;
        await this.assignmentRepo.save(a);
      }
    }
  }

  /**
   * Reverses every change recorded by {@link apply}: re-instates cancelled
   * parts, restores mutated fields, and removes the added talks. Safe to call
   * when nothing was applied (no-op).
   */
  async revert(event: SpecialEvent): Promise<void> {
    const ops = (event.coRevertData as RevertOp[] | null) ?? [];
    if (ops.length === 0) return;

    await this.assignmentRepo.manager.transaction(async (em) => {
      const aRepo = em.getRepository(Assignment);
      const eRepo = em.getRepository(SpecialEvent);

      // Undo in reverse so additions are removed before restores, etc.
      for (const op of [...ops].reverse()) {
        if (op.op === 'meeting') continue;
        if (op.op === 'added') {
          await aRepo.delete({ id: op.id });
          continue;
        }
        if (op.op === 'deleted') {
          await aRepo.restore({ id: op.id });
          continue;
        }
        const a = await aRepo.findOne({ where: { id: op.id } });
        if (!a) continue;
        if (op.op === 'status') {
          a.status = op.prev;
        } else if (op.field === 'partDurationMin') {
          a.partDurationMin = op.prev as number | null;
        } else if (op.field === 'partTitle') {
          a.partTitle = op.prev as string | null;
        } else {
          a.speakerName = op.prev as string | null;
        }
        await aRepo.save(a);
      }

      event.coRevertData = null;
      await eRepo.save(event);
      this.logger.log(
        `CO visit ${event.id}: reverted ${ops.length} template changes`,
      );
    });
  }
}
