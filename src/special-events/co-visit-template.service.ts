import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

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
  | { op: 'deleted'; id: string };

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday of the ISO week containing the given date. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtISO(d);
}

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
  ) {}

  /**
   * Applies the circuit-overseer program to the visit week (midweek + weekend)
   * and records the undo plan on the event. Idempotent: if the event already
   * carries a revert plan, this is a no-op. Each meeting is only touched when
   * its programme has already been imported (otherwise we'd create orphan
   * talks in an empty week).
   */
  async apply(event: SpecialEvent): Promise<SpecialEvent> {
    if (event.type !== CIRCUIT_OVERSEER_VISIT_TYPE) return event;
    if (event.coRevertData && (event.coRevertData as RevertOp[]).length > 0) {
      return event; // already applied
    }

    const week = mondayOf(event.date);
    const speaker = coDisplayName(event);

    return this.assignmentRepo.manager.transaction(async (em) => {
      const aRepo = em.getRepository(Assignment);
      const eRepo = em.getRepository(SpecialEvent);
      const ops: RevertOp[] = [];

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
      if (midweek.length > 0) {
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
      }

      // ---- Weekend: CO public talk, 30-min WT study (no reader), concluding talk ----
      const weekend = await loadMeeting(EventType.WEEKEND);
      if (weekend.length > 0) {
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
      }

      event.coRevertData = ops;
      const persisted = await eRepo.save(event);
      this.logger.log(
        `CO visit ${event.id}: applied template to week ${week} (${ops.length} changes)`,
      );
      return persisted;
    });
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
