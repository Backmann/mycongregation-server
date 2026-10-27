import {
  DutyType,
  MEETING_RUN_DUTIES,
  SINGLE_SLOT_DUTIES_AFTER_MIC,
  SINGLE_SLOT_DUTIES_BEFORE_MIC,
} from '../common/enums/duty-type.enum';

/**
 * THE CONGREGATION'S PLACES (Lionel, 27 October 2026).
 *
 * The sheet of every midweek and weekend meeting used to be cut from one list
 * written in the code. A place the congregation added («Стоянка»), a name it
 * gave, the order it chose and the note it wrote («жилетки в шкафу») lived on
 * that ONE meeting only, and the next week started from the code's list again.
 * The Memorial alone carried its places over, from the year before.
 *
 * Now a congregation keeps its places once per kind of meeting, and a new
 * sheet is cut from them. Until it saves any, the places are the code's list
 * — exactly what every sheet got until today, so nothing moves the day this
 * ships.
 *
 * A place is known by WHAT it is: a predefined duty by its type (one place per
 * type), a congregation's own by its name. That is how the sheets have always
 * grouped their rows, so no new key is written onto the rows themselves.
 *
 * Everything here is pure: the database work is in DutiesService.
 */

export type PlaceKind = 'midweek' | 'weekend';

export interface PlaceSpec {
  /** Kept for a stored place, so a renamed one is known by what it was. */
  id?: string | null;
  dutyType: DutyType;
  /** The congregation's own name — for CUSTOM only, null otherwise. */
  customLabel: string | null;
  /** How many people stand there. */
  count: number;
  /** What the person there must know beforehand. */
  notes: string | null;
  /**
   * Whose card qualifies, for a place of the congregation's own («Стоянка»
   * takes the attendants). A predefined place always asks its own
   * `duty_<type>`; null on a custom place — anybody.
   */
  capability: string | null;
}

/** The capabilities a place may ask for — the app's duty column of the card. */
export const PLACE_CAPABILITIES = [
  'duty_security',
  'duty_attendant',
  'duty_microphone',
  'duty_av',
  'duty_zoom',
  'duty_stage',
  'duty_ventilation',
  'duty_timekeeper',
] as const;

export const MAX_PLACE_COUNT = 10;
export const DEFAULT_MICROPHONES = 2;

/** One key per place: the type, or the congregation's own name. */
export function placeKey(p: {
  dutyType: DutyType | string;
  customLabel: string | null;
}): string {
  return String(p.dutyType) === String(DutyType.CUSTOM)
    ? `custom:${(p.customLabel ?? '').trim()}`
    : String(p.dutyType);
}

/**
 * The code's list — what a sheet got before a congregation kept its own:
 * the fixed places either side of the microphones, as many microphones as the
 * meeting settings say, and the timekeeper.
 */
export function defaultPlaces(
  microphones: number | null | undefined,
): PlaceSpec[] {
  const one = (dutyType: DutyType): PlaceSpec => ({
    dutyType,
    customLabel: null,
    count: 1,
    notes: null,
    capability: null,
  });
  return [
    ...SINGLE_SLOT_DUTIES_BEFORE_MIC.map(one),
    { ...one(DutyType.MICROPHONE), count: microphones ?? DEFAULT_MICROPHONES },
    ...SINGLE_SLOT_DUTIES_AFTER_MIC.map(one),
    ...MEETING_RUN_DUTIES.map(one),
  ];
}

/**
 * What is wrong with a list of places, or null. Said in the refusal's own
 * words so the app can show it.
 */
export function placesProblem(places: PlaceSpec[]): string | null {
  if (places.length === 0) return 'A meeting needs at least one place.';
  if (places.length > 40) return 'Too many places.';
  const seen = new Set<string>();
  for (const p of places) {
    if (!Object.values(DutyType).includes(p.dutyType)) {
      return `Unknown duty type: ${String(p.dutyType)}`;
    }
    if (p.dutyType === DutyType.CUSTOM) {
      const label = (p.customLabel ?? '').trim();
      if (!label) return 'A place of your own needs a name.';
      if (label.length > 60) return 'A place name is at most 60 characters.';
    }
    if (
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > MAX_PLACE_COUNT
    ) {
      return `Each place has 1 to ${MAX_PLACE_COUNT} people.`;
    }
    if (
      p.capability != null &&
      !(PLACE_CAPABILITIES as readonly string[]).includes(p.capability)
    ) {
      return `Unknown capability: ${p.capability}`;
    }
    const key = placeKey(p).toLocaleLowerCase();
    if (seen.has(key)) return 'Each place appears once.';
    seen.add(key);
  }
  return null;
}

/** Cleaned for storing: names trimmed, the fields a kind does not use cleared. */
export function normalisePlaces(places: PlaceSpec[]): PlaceSpec[] {
  return places.map((p) => ({
    id: p.id ?? null,
    dutyType: p.dutyType,
    customLabel:
      p.dutyType === DutyType.CUSTOM ? (p.customLabel ?? '').trim() : null,
    count: p.count,
    notes: p.notes?.trim() ? p.notes.trim() : null,
    capability: p.dutyType === DutyType.CUSTOM ? (p.capability ?? null) : null,
  }));
}

/** The capability a row of this place asks for, or null for anybody. */
export function capabilityOfPlace(
  dutyType: DutyType | string,
  customLabel: string | null,
  places: PlaceSpec[],
): string | null {
  if (String(dutyType) !== String(DutyType.CUSTOM)) return `duty_${dutyType}`;
  const key = placeKey({ dutyType, customLabel });
  return places.find((p) => placeKey(p) === key)?.capability ?? null;
}

/** A row of a sheet, as much of it as the plan needs. */
export interface SheetRow {
  id: string;
  dutyType: DutyType;
  customLabel: string | null;
  slotIndex: number;
  sortOrder: number;
  notes: string | null;
  publisherId: string | null;
}

export interface SheetPlan {
  insert: Omit<SheetRow, 'id' | 'publisherId'>[];
  /** Empty rows that go. */
  remove: string[];
  update: {
    id: string;
    customLabel?: string | null;
    sortOrder?: number;
    notes?: string | null;
  }[];
  /**
   * Rows that stay although the template no longer has room for them —
   * somebody stands there, and taking him off is the coordinator's call.
   */
  kept: SheetRow[];
}

/**
 * How one sheet follows a change of its template (Lionel's choice of
 * 27 October 2026 — «нужен совет», and the advice taken):
 *
 *  - a place added appears, empty;
 *  - a name, the order or the note changes everywhere; the people stay;
 *  - a place removed goes where nobody stands; where somebody does, it
 *    stays, and the app marks it «only on this meeting»;
 *  - more people: rows are added; fewer: only empty rows go;
 *  - a place that was never in the template — added for one evening — is the
 *    meeting's own and is left as it is, after the template's places.
 *
 * `renames` maps a custom place's old name to its new one. A note on a row is
 * replaced only while it still says what the old template said: a note
 * written for one evening is that evening's.
 */
export function planSheet(
  rows: SheetRow[],
  oldPlaces: PlaceSpec[],
  newPlaces: PlaceSpec[],
  renames: Map<string, string>,
): SheetPlan {
  const plan: SheetPlan = { insert: [], remove: [], update: [], kept: [] };
  const patch = new Map<string, SheetPlan['update'][number]>();
  const touch = (id: string) => {
    let u = patch.get(id);
    if (!u) {
      u = { id };
      patch.set(id, u);
    }
    return u;
  };

  // Rows as they will be named after the renames.
  const live = rows.map((r) => {
    if (r.dutyType === DutyType.CUSTOM && r.customLabel != null) {
      const to = renames.get(r.customLabel.trim());
      if (to != null && to !== r.customLabel) {
        touch(r.id).customLabel = to;
        return { ...r, customLabel: to };
      }
    }
    return r;
  });

  const oldByKey = new Map<string, PlaceSpec>();
  for (const p of oldPlaces) {
    const key = placeKey(p);
    const renamed =
      p.dutyType === DutyType.CUSTOM && p.customLabel != null
        ? renames.get(p.customLabel.trim())
        : undefined;
    oldByKey.set(
      renamed != null ? placeKey({ ...p, customLabel: renamed }) : key,
      p,
    );
  }
  const newKeys = new Set(newPlaces.map(placeKey));

  let nextCustomSlot =
    Math.max(
      -1,
      ...live
        .filter((r) => r.dutyType === DutyType.CUSTOM)
        .map((r) => r.slotIndex),
    ) + 1;

  let order = 0;
  for (const place of newPlaces) {
    order += 1;
    const key = placeKey(place);
    const before = oldByKey.get(key);
    const mine = live
      .filter((r) => placeKey(r) === key)
      .sort((a, b) => a.slotIndex - b.slotIndex);

    for (const r of mine) {
      if (r.sortOrder !== order) touch(r.id).sortOrder = order;
      const oldNote = before?.notes ?? null;
      if ((r.notes ?? null) === oldNote && (place.notes ?? null) !== oldNote) {
        touch(r.id).notes = place.notes ?? null;
      }
    }

    if (mine.length < place.count) {
      let nextSlot =
        place.dutyType === DutyType.CUSTOM
          ? nextCustomSlot
          : Math.max(-1, ...mine.map((r) => r.slotIndex)) + 1;
      for (let n = mine.length; n < place.count; n++) {
        plan.insert.push({
          dutyType: place.dutyType,
          customLabel:
            place.dutyType === DutyType.CUSTOM ? place.customLabel : null,
          slotIndex: nextSlot++,
          sortOrder: order,
          notes: place.notes ?? null,
        });
      }
      if (place.dutyType === DutyType.CUSTOM) nextCustomSlot = nextSlot;
    } else if (mine.length > place.count) {
      let extra = mine.length - place.count;
      // The empty ones go, from the last; a person is never taken off here.
      for (const r of [...mine].reverse()) {
        if (extra === 0) break;
        if (!r.publisherId) {
          plan.remove.push(r.id);
          extra -= 1;
        }
      }
      if (extra > 0) {
        const left = mine.filter((r) => !plan.remove.includes(r.id));
        plan.kept.push(...left.slice(place.count));
      }
    }
  }

  // What the template does not hold, after its places, in the order it had.
  const rest = live
    .filter((r) => !newKeys.has(placeKey(r)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slotIndex - b.slotIndex);
  let lastKey = '';
  for (const r of rest) {
    const key = placeKey(r);
    const wasTemplate = oldByKey.has(key);
    if (wasTemplate && !r.publisherId) {
      plan.remove.push(r.id);
      continue;
    }
    if (wasTemplate) plan.kept.push(r);
    if (key !== lastKey) {
      order += 1;
      lastKey = key;
    }
    if (r.sortOrder !== order) touch(r.id).sortOrder = order;
  }

  for (const id of plan.remove) patch.delete(id);
  plan.update = [...patch.values()].filter(
    (u) =>
      u.customLabel !== undefined ||
      u.sortOrder !== undefined ||
      u.notes !== undefined,
  );
  return plan;
}

/** True when a plan changes nothing. */
export function planIsEmpty(p: SheetPlan): boolean {
  return (
    p.insert.length === 0 && p.remove.length === 0 && p.update.length === 0
  );
}

/**
 * The rows of a new sheet: a predefined place has slots 0…count-1, the
 * congregation's own share one running slot number between them (the unique
 * key is per type), and every row of a place shares its position and note.
 */
export function rowsOfPlaces(
  places: PlaceSpec[],
): Omit<SheetRow, 'id' | 'publisherId'>[] {
  const out: Omit<SheetRow, 'id' | 'publisherId'>[] = [];
  let customSlot = 0;
  places.forEach((p, i) => {
    for (let n = 0; n < p.count; n++) {
      out.push({
        dutyType: p.dutyType,
        customLabel: p.dutyType === DutyType.CUSTOM ? p.customLabel : null,
        slotIndex: p.dutyType === DutyType.CUSTOM ? customSlot++ : n,
        sortOrder: i + 1,
        notes: p.notes ?? null,
      });
    }
  });
  return out;
}
