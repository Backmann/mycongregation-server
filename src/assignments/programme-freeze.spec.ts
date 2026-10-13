import { ConflictException, ForbiddenException } from '@nestjs/common';
import { weekRules, WeekEvent } from '../common/week-rules';
import { clockStub } from '../common/testing/clock-stub';
import { ProgrammeFreezeService } from './programme-freeze.service';
import { programmeDayOf, programmeLock } from './programme-freeze';
import { AssignmentsService } from './assignments.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { MwbImportService } from '../mwb-import/mwb-import.service';
import { AuditRevertService } from '../audit-revert/audit-revert.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { AssignmentsModule } from './assignments.module';
import { TalkExchangeModule } from '../talk-exchange/talk-exchange.module';
import { MwbImportModule } from '../mwb-import/mwb-import.module';
import { AuditRevertModule } from '../audit-revert/audit-revert.module';
import { ProgrammeFreezeModule } from './programme-freeze.module';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * The programme becomes the record a week after its meeting (13 October
 * 2026). Every path that writes the programme asks one rule — and every
 * path is held to it here, with the real rule, the real week rules and the
 * congregation's own clock.
 */

const C = 'cong-1';
// Midweek on Wednesday, weekend on Sunday.
const VERSIONS = [
  { effectiveFrom: '2020-01-01', midweekDow: 3, weekendDow: 7 },
];
// The week of Monday 28 September 2026: Wednesday 30 Sep, Sunday 4 Oct.
const WEEK = '2026-09-28';

const rulesFor = (week: string, events: WeekEvent[] = []) =>
  weekRules({ weekStart: week, versions: VERSIONS, events });

/** «Now» as a moment, so the congregation's clock does the day. */
let nowSpy: jest.SpyInstance;
const at = (iso: string) => {
  nowSpy?.mockRestore();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));
};
afterEach(() => nowSpy?.mockRestore());

function freezeWith(
  opts: {
    events?: WeekEvent[];
    responsibilities?: string[];
  } = {},
) {
  const audit = {
    logEvent: jest.fn(),
    logUpdate: jest.fn(),
    logCreate: jest.fn(),
  };
  const weekRulesSvc = {
    forWeeks: async (_c: string, weeks: string[]) =>
      new Map(weeks.map((w) => [w, rulesFor(w, opts.events)])),
  };
  const responsibilities = {
    count: jest.fn(async ({ where }: any) =>
      (opts.responsibilities ?? []).includes(where.type) ? 1 : 0,
    ),
  };
  const freeze = new ProgrammeFreezeService(
    weekRulesSvc as any,
    clockStub('Europe/Berlin'),
    audit as any,
    responsibilities as any,
  );
  return { freeze, audit };
}

const user = (role: UserRole = UserRole.PUBLISHER) =>
  ({
    id: 'u-1',
    congregationId: C,
    role,
    uiLanguage: 'ru',
    email: null,
  }) as any;

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e: any) {
    return e?.getResponse?.()?.code;
  }
  return undefined;
}

describe('the rule', () => {
  it('a meeting freezes the day after its seventh day', () => {
    const r = rulesFor(WEEK);
    expect(programmeDayOf(r, 'midweek')).toBe('2026-09-30');
    expect(programmeLock(r, 'midweek', '2026-10-07')).toEqual({
      meetingDate: '2026-09-30',
      editableUntil: '2026-10-07',
      held: true,
      frozen: false,
    });
    expect(programmeLock(r, 'midweek', '2026-10-08').frozen).toBe(true);
    // The day itself: not yet held.
    expect(programmeLock(r, 'midweek', '2026-09-30').held).toBe(false);
  });

  it('the weekend by its own day', () => {
    expect(programmeLock(rulesFor(WEEK), 'weekend', '2026-10-11').frozen).toBe(
      false,
    );
    expect(programmeLock(rulesFor(WEEK), 'weekend', '2026-10-12').frozen).toBe(
      true,
    );
  });

  it('a circuit visit moves the midweek day, and the freeze with it', () => {
    const r = rulesFor(WEEK, [
      { type: 'circuit_overseer_visit', date: WEEK, coMidweekDow: 2 },
    ]);
    expect(programmeDayOf(r, 'midweek')).toBe('2026-09-29');
  });

  it('a convention week is judged by the day the meeting would have had', () => {
    const r = rulesFor(WEEK, [
      {
        type: 'regional_convention',
        date: '2026-10-02',
        endDate: '2026-10-04',
      },
    ]);
    expect(r.meetingsHeld).toBe(false);
    expect(programmeDayOf(r, 'weekend')).toBe('2026-10-04');
  });

  it('the Memorial by its own date, else the week’s Sunday', () => {
    const withMemorial = rulesFor(WEEK, [
      { type: 'memorial', date: '2026-09-29' },
    ]);
    expect(programmeDayOf(withMemorial, 'memorial')).toBe('2026-09-29');
    expect(programmeDayOf(rulesFor(WEEK), 'memorial')).toBe('2026-10-04');
  });
});

describe('the door — ProgrammeFreezeService', () => {
  it('counts the day by the congregation’s clock, not UTC', async () => {
    const { freeze } = freezeWith();
    // 7 Oct, 23:30 in Berlin is still the 7th there — the last open day —
    // although UTC already... is not yet the 8th either; and 8 Oct 00:30 in
    // Berlin is 7 Oct 22:30 UTC: frozen in Berlin, open by UTC.
    at('2026-10-07T21:30:00Z');
    expect(
      (await freeze.lockOf(C, { weekStartDate: WEEK, eventType: 'midweek' }))
        .frozen,
    ).toBe(false);
    at('2026-10-07T22:30:00Z');
    expect(
      (await freeze.lockOf(C, { weekStartDate: WEEK, eventType: 'midweek' }))
        .frozen,
    ).toBe(true);
  });

  it('refuses an ordinary write to a frozen meeting, and says so in the journal', async () => {
    at('2026-10-13T10:00:00Z');
    const { freeze, audit } = freezeWith();
    let err: any;
    try {
      await freeze.assertWritable(C, [
        { weekStartDate: WEEK, eventType: 'midweek' },
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      code: 'PROGRAMME_PAST_LOCKED',
      date: '2026-09-30',
      until: '2026-10-07',
    });
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DENY',
        detail: {
          reason: 'programme_frozen',
          weekStartDate: WEEK,
          eventType: 'midweek',
        },
      }),
    );
  });

  it('lets an open meeting through, as an ordinary write', async () => {
    at('2026-10-05T10:00:00Z');
    const { freeze } = freezeWith();
    await expect(
      freeze.assertWritable(
        C,
        [{ weekStartDate: WEEK, eventType: 'midweek' }],
        {
          retroactive: true,
          user: user(UserRole.ADMIN),
        },
      ),
    ).resolves.toEqual({ retroactive: false });
  });

  it('a fix after the fact: the administrator and the body coordinator may, nobody else', async () => {
    at('2026-10-13T10:00:00Z');
    const m = [{ weekStartDate: WEEK, eventType: 'midweek' }];
    await expect(
      freezeWith().freeze.assertWritable(C, m, {
        retroactive: true,
        user: user(UserRole.ADMIN),
      }),
    ).resolves.toEqual({ retroactive: true });
    await expect(
      freezeWith({
        responsibilities: [ResponsibilityType.BODY_COORDINATOR],
      }).freeze.assertWritable(C, m, { retroactive: true, user: user() }),
    ).resolves.toEqual({ retroactive: true });
    // The midweek overseer edits the midweek programme — but not the record.
    const other = freezeWith({
      responsibilities: [ResponsibilityType.LIFE_MINISTRY_OVERSEER],
    });
    let err: any;
    try {
      await other.freeze.assertWritable(C, m, {
        retroactive: true,
        user: user(),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('PROGRAMME_FIX_FORBIDDEN');
    // Without a user at all: no.
    expect(
      await codeOf(
        freezeWith().freeze.assertWritable(C, m, { retroactive: true }),
      ),
    ).toBe('PROGRAMME_FIX_FORBIDDEN');
  });
});

// ---- every writer of the programme -----------------------------------------

function rowsRepo(rows: any[]) {
  const qbUpdate: any = {
    update: jest.fn(() => qbUpdate),
    set: jest.fn(() => qbUpdate),
    where: jest.fn(() => qbUpdate),
    andWhere: jest.fn(() => qbUpdate),
    execute: jest.fn(async () => ({ affected: 0 })),
  };
  return {
    rows,
    findOne: jest.fn(
      async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    ),
    find: jest.fn(async () => []),
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => v),
    softDelete: jest.fn(async () => ({ affected: 1 })),
    restore: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qbUpdate),
    qbUpdate,
  };
}

function programmeService(
  rows: any[],
  freezeOpts: Parameters<typeof freezeWith>[0] = {},
) {
  const repo = rowsRepo(rows);
  const { freeze, audit } = freezeWith(freezeOpts);
  const talkExchange = {
    syncProgramToJournal: jest.fn(),
    fillEmptySlot: jest.fn(),
  };
  const duties = { reconcileTreasuresMic: jest.fn(async () => []) };
  const localNeeds = { releaseAssignment: jest.fn() };
  const coVisit = { applyForWeek: jest.fn() };
  const congregations = {
    findOne: jest.fn(async () => ({ assignmentAutomationEnabled: true })),
  };
  const publishers = {
    findOne: jest.fn(async () => ({ capabilities: { opening_prayer: true } })),
  };
  const reminders = { pendingNotice: jest.fn(async () => ({ rows: ['x'] })) };
  const svc = new AssignmentsService(
    repo as any,
    { find: jest.fn(async () => []), count: jest.fn(async () => 0) } as any,
    publishers as any,
    congregations as any,
    { find: jest.fn(async () => []) } as any,
    {} as any,
    { notify: jest.fn() } as any,
    talkExchange as any,
    audit as any,
    duties as any,
    localNeeds as any,
    clockStub('Europe/Berlin'),
    coVisit as any,
    freeze,
    reminders as any,
  );
  return {
    svc,
    repo,
    audit,
    talkExchange,
    duties,
    localNeeds,
    coVisit,
    reminders,
  };
}

const part = (extra: Record<string, unknown> = {}) => ({
  id: 'a-1',
  congregationId: C,
  weekStartDate: WEEK,
  eventType: 'midweek',
  partKey: 'treasures_talk',
  status: 'published',
  publisherId: 'p-old',
  deletedAt: null,
  changedSincePublish: false,
  ...extra,
});

describe('AssignmentsService under the freeze', () => {
  beforeEach(() => at('2026-10-13T10:00:00Z')); // 30 Sep is frozen since the 8th

  it('refuses to change a frozen part, and writes nothing', async () => {
    const { svc, repo } = programmeService([part()]);
    expect(
      await codeOf(svc.update(C, 'a-1', { publisherId: 'p-new' } as any)),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to move an open part INTO a frozen week', async () => {
    const { svc, repo } = programmeService([
      part({ weekStartDate: '2026-10-12' }),
    ]);
    expect(
      await codeOf(svc.update(C, 'a-1', { weekStartDate: WEEK } as any)),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to create, delete and restore in a frozen week', async () => {
    const { svc, repo } = programmeService([
      part(),
      part({ id: 'a-2', deletedAt: new Date() }),
    ]);
    expect(
      await codeOf(
        svc.create(C, {
          weekStartDate: WEEK,
          eventType: 'midweek',
          partKey: 'x',
        } as any),
      ),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(await codeOf(svc.remove(C, 'a-1'))).toBe('PROGRAMME_PAST_LOCKED');
    repo.findOne.mockImplementation(async ({ where }: any) =>
      where.id === 'a-2'
        ? { ...part({ id: 'a-2', deletedAt: new Date() }) }
        : null,
    );
    expect(await codeOf(svc.restore(C, 'a-2'))).toBe('PROGRAMME_PAST_LOCKED');
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('a batch over an open week and a frozen one writes nothing at all', async () => {
    const { svc, repo } = programmeService([]);
    expect(
      await codeOf(
        svc.bulkCreate(C, [
          { weekStartDate: '2026-10-12', eventType: 'midweek', partKey: 'a' },
          { weekStartDate: WEEK, eventType: 'midweek', partKey: 'b' },
        ] as any),
      ),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('a fix after the fact does not move a row out of (or into) a frozen meeting', async () => {
    const { svc, repo } = programmeService([part()]);
    expect(
      await codeOf(
        svc.update(
          C,
          'a-1',
          { weekStartDate: '2026-10-19', retroactive: true } as any,
          user(UserRole.ADMIN),
        ),
      ),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('a fix after the fact changes the row and nothing else, marked in the journal', async () => {
    const { svc, repo, audit, talkExchange, duties, localNeeds } =
      programmeService([
        part({ partKey: 'public_talk_speaker', eventType: 'weekend' }),
      ]);
    // Weekend 4 Oct: frozen since the 12th; today the 13th.
    const saved: any = await svc.update(
      C,
      'a-1',
      { publisherId: 'p-new', partTitle: 'другая', retroactive: true } as any,
      user(UserRole.ADMIN),
    );
    expect(saved.publisherId).toBe('p-new');
    expect(saved.retroactive).toBeUndefined();
    expect(saved.changedSincePublish).toBe(false);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(talkExchange.syncProgramToJournal).not.toHaveBeenCalled();
    expect(duties.reconcileTreasuresMic).not.toHaveBeenCalled();
    expect(localNeeds.releaseAssignment).not.toHaveBeenCalled();
    const entry = audit.logUpdate.mock.calls[0][0];
    expect(entry.after.retroactive).toBe(true);
    expect(entry.fields).toContain('retroactive');
  });

  it('within the week of grace: an ordinary edit, but nobody is told and no helper runs', async () => {
    at('2026-10-05T10:00:00Z'); // 30 Sep held, open until the 7th
    const { svc, repo, duties } = programmeService([part()]);
    const saved: any = await svc.update(C, 'a-1', {
      publisherId: 'p-new',
    } as any);
    expect(saved.publisherId).toBe('p-new');
    expect(saved.changedSincePublish).toBe(false);
    // Treasures → microphone would rewrite the duties, frozen since 1 Oct.
    expect(duties.reconcileTreasuresMic).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('a meeting still ahead: edited and announced as before', async () => {
    at('2026-09-25T10:00:00Z');
    const { svc } = programmeService([part()]);
    const saved: any = await svc.update(C, 'a-1', {
      publisherId: 'p-new',
    } as any);
    expect(saved.changedSincePublish).toBe(true);
  });

  it('a held meeting is published quietly and announces no changes', async () => {
    const { svc, repo, reminders } = programmeService([]);
    await svc.publishMeeting(C, WEEK, 'midweek' as any, true);
    // The «who to tell» list was never even read.
    expect(repo.find).not.toHaveBeenCalled();
    expect(await svc.notifyChanges(C, WEEK, 'midweek' as any)).toEqual({
      notified: 0,
    });
    expect(repo.qbUpdate.set).toHaveBeenCalledWith({
      changedSincePublish: false,
    });
    expect(await svc.pendingNotice(C, WEEK, 'midweek' as any)).toMatchObject({
      rows: [],
    });
    expect(reminders.pendingNotice).not.toHaveBeenCalled();
  });

  it('answers how the week stands, and whether this reader may fix it', async () => {
    const { svc } = programmeService([]);
    const locks = await svc.locksOfWeek(C, WEEK, user(UserRole.ADMIN));
    expect(locks.meetings.midweek).toEqual({
      meetingDate: '2026-09-30',
      editableUntil: '2026-10-07',
      held: true,
      frozen: true,
    });
    expect(locks.meetings.weekend.meetingDate).toBe('2026-10-04');
    expect(locks.mayFixAfterwards).toBe(true);
    expect((await svc.locksOfWeek(C, WEEK, user())).mayFixAfterwards).toBe(
      false,
    );
  });
});

describe('the workbook import under the freeze', () => {
  beforeEach(() => at('2026-10-13T10:00:00Z'));

  it('skips a frozen week out loud and writes nothing', async () => {
    const repo = rowsRepo([]);
    const { freeze } = freezeWith();
    const svc = new MwbImportService(
      repo as any,
      { pendingForWeek: async () => [{ eventType: 'midweek' }] } as any,
      {
        heldForWeek: async () => ({ rows: new Set(), fields: new Map() }),
        applyForWeek: jest.fn(),
      } as any,
      { fillEmptySlot: jest.fn(), syncProgramToJournal: jest.fn() } as any,
      freeze,
    );
    const result: any = await svc.applyParsed(C, {
      epubFile: 'mwb_U_202609.epub',
      year: 2026,
      weeks: [
        {
          weekStartDate: WEEK,
          weekEndDate: '2026-10-04',
          biblePassage: '',
          parts: [
            { partKey: 'treasures_talk', partOrder: 1, partTitle: 'X' },
            { partKey: 'bible_reading', partOrder: 2, partTitle: 'Y' },
          ],
        },
      ],
    } as any);
    expect(repo.save).not.toHaveBeenCalled();
    expect(result.weeksImported).toBe(0);
    expect(result.partsSkipped).toBe(2);
    expect(result.weeks[0]).toMatchObject({ frozen: true, skipped: 2 });
    expect(result.notices).toContainEqual({
      code: 'week_frozen',
      weekStartDate: WEEK,
      meeting: 'midweek',
      parts: 2,
      editableUntil: '2026-10-07',
    });
  });
});

describe('the talk journal under the freeze', () => {
  beforeEach(() => at('2026-10-13T10:00:00Z')); // weekend 4 Oct frozen

  function journal(slot: any) {
    const svc = Object.create(TalkExchangeService.prototype) as any;
    svc.assignmentRepo = {
      findOne: jest.fn(async () => slot),
      save: jest.fn(async (v: any) => v),
    };
    svc.freeze = freezeWith().freeze;
    return svc;
  }

  it('saves the entry but leaves a frozen programme as it was', async () => {
    const slot = {
      id: 's',
      weekStartDate: WEEK,
      partKey: 'public_talk',
      publisherId: null,
      speakerName: null,
    };
    const svc = journal(slot);
    const out = await svc.applyIncomingToProgram(
      C,
      {
        id: 'e',
        date: '2026-10-04',
        publicTalkId: 't-1',
        speakerName: 'Гость',
      },
      true,
    );
    expect(out.programmeFrozen).toBe(true);
    expect(svc.assignmentRepo.save).not.toHaveBeenCalled();
  });

  it('an old entry whose programme already says the same is not reported as left alone', async () => {
    const slot = {
      id: 's',
      weekStartDate: WEEK,
      partKey: 'public_talk_speaker',
      publisherId: null,
      speakerName: 'Гость',
      publicTalkId: 't-1',
      specialTalk: false,
    };
    const svc = journal(slot);
    svc.speakerRepo = { findOne: jest.fn(async () => null) };
    const out = await svc.applyIncomingToProgram(
      C,
      {
        id: 'e',
        date: '2026-10-04',
        publicTalkId: 't-1',
        speakerName: 'Гость',
      },
      false,
    );
    expect(out.programmeFrozen).toBeUndefined();
    expect(svc.assignmentRepo.save).not.toHaveBeenCalled();
  });

  it('a cleared entry does not clear a frozen slot', async () => {
    const slot = {
      id: 's',
      weekStartDate: WEEK,
      partKey: 'public_talk',
      speakerName: 'Гость',
      publicTalkId: 't-1',
    };
    const svc = journal(slot);
    await svc.clearProgramSlot(C, { date: '2026-10-04', publisherId: null });
    expect(svc.assignmentRepo.save).not.toHaveBeenCalled();
  });

  it('refuses «replace the speaker» for a frozen week', async () => {
    const slot = { id: 's', weekStartDate: WEEK, partKey: 'public_talk' };
    const svc = journal(slot);
    svc.assertCanWrite = jest.fn();
    expect(
      await codeOf(
        svc.replaceSpeaker(C, user(), { weekStartDate: WEEK } as any),
      ),
    ).toBe('PROGRAMME_PAST_LOCKED');
    expect(svc.assignmentRepo.save).not.toHaveBeenCalled();
  });
});

describe('the journal’s «Вернуть» under the freeze', () => {
  it('says before pressing that a frozen part cannot be put back', async () => {
    at('2026-10-13T10:00:00Z');
    const svc = Object.create(AuditRevertService.prototype) as any;
    svc.assertMayAsk = () => undefined;
    svc.entry = async () => ({
      action: 'UPDATE',
      entityType: 'assignment',
      entityId: 'a-1',
      beforeJson: JSON.stringify({ publisherId: 'p-old' }),
      afterJson: JSON.stringify({ publisherId: 'p-new' }),
      redactedAt: null,
    });
    svc.mayRevert = async () => true;
    svc.parse = (j: string) => JSON.parse(j);
    svc.revertable = {
      assignment: { fields: ['publisherId'], apply: jest.fn() },
    };
    svc.assignmentsRepo = {
      findOne: async () => ({
        id: 'a-1',
        weekStartDate: WEEK,
        eventType: 'midweek',
      }),
    };
    svc.freeze = freezeWith().freeze;
    expect(await svc.preview(C, 'log-1', user(UserRole.ADMIN))).toMatchObject({
      supported: false,
      reason: 'programmeFrozen',
    });
  });
});

describe('wiring', () => {
  // Two of the writers take the freeze as optional (specs build them from
  // their prototype); the modules are what make it present in the app.
  it.each([
    ['AssignmentsModule', AssignmentsModule],
    ['TalkExchangeModule', TalkExchangeModule],
    ['MwbImportModule', MwbImportModule],
    ['AuditRevertModule', AuditRevertModule],
  ])('%s imports the programme freeze', (_name, mod) => {
    const imports: unknown[] = Reflect.getMetadata('imports', mod) ?? [];
    expect(imports).toContain(ProgrammeFreezeModule);
  });
});
