jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { AssignmentRemindersService } from './assignment-reminders.service';

const MON = '2026-10-19'; // Monday; midweek on Thursday the 22nd
const MEETING = '2026-10-22';

/**
 * A congregation with one published part held by publisher p1 (login u1), and
 * whatever marks the test starts with. The repositories are the least that
 * the service asks of them; the RULES are the real ones from digest.ts.
 */
function build(over: {
  marks?: any[];
  parts?: any[];
  duties?: any[];
  ladder?: string | null;
  now?: string;
  tokens?: any[];
  email?: string | null;
}) {
  const marks: any[] = [...(over.marks ?? [])];
  const parts = over.parts ?? [
    {
      id: 'a1',
      weekStartDate: MON,
      eventType: 'midweek',
      partKey: 'bible_reading',
      partTitle: null,
      publisherId: 'p1',
      assistantPublisherId: null,
      status: 'published',
      deletedAt: null,
      changedSincePublish: false,
    },
  ];
  const sent: any[] = [];
  const noticeRepo = {
    find: jest.fn(async (q: any) =>
      marks.filter(
        (m) =>
          !q?.where?.itemId ||
          (q.where.itemId._value as string[]).includes(m.itemId),
      ),
    ),
    delete: jest.fn(async (where: any) => {
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i];
        const past =
          where.meetingDate && m.meetingDate < where.meetingDate._value;
        const same =
          where.itemId &&
          m.userId === where.userId &&
          m.itemId === where.itemId;
        if (past || same) marks.splice(i, 1);
      }
    }),
    upsert: jest.fn(async (rows: any[]) => {
      for (const r of rows) {
        const i = marks.findIndex(
          (m) => m.userId === r.userId && m.itemId === r.itemId,
        );
        if (i >= 0) marks[i] = { ...marks[i], ...r };
        else marks.push(r);
      }
    }),
  };
  const svc = new AssignmentRemindersService(
    { find: jest.fn(async () => parts) } as any,
    { find: jest.fn(async () => over.duties ?? []) } as any,
    {
      find: jest.fn(async () => [
        { id: 'p1', userId: 'u1', displayName: 'Бойко Виктор' },
      ]),
    } as any,
    {
      find: jest.fn(async () => [
        {
          id: 'u1',
          uiLanguage: 'ru',
          reminderLadder: over.ladder ?? null,
          email: 'email' in over ? over.email : 'u1@example.invalid',
          isActive: true,
        },
      ]),
    } as any,
    noticeRepo as any,
    {
      find: jest.fn(async () => [{ id: 'cong-1', timezone: 'Europe/Berlin' }]),
      findOne: jest.fn(async () => ({
        id: 'cong-1',
        timezone: 'Europe/Berlin',
        language: 'ru',
      })),
    } as any,
    { find: jest.fn(async () => []) } as any,
    { find: jest.fn(async () => []) } as any,
    { find: jest.fn(async () => over.tokens ?? []) } as any,
    { find: jest.fn(async () => []) } as any,
    {
      forWeeks: jest.fn(async (_c: string, weeks: string[]) => {
        const out = new Map();
        for (const w of weeks) {
          out.set(w, {
            meetings: w === MON ? [{ kind: 'midweek', date: MEETING }] : [],
          });
        }
        return out;
      }),
      forWeek: jest.fn(async () => ({
        meetings: [{ kind: 'midweek', date: MEETING }],
      })),
    } as any,
    { forRange: jest.fn(async () => []) } as any,
    { notify: jest.fn(async (n: any) => void sent.push(n)) } as any,
  );
  return { svc, marks, sent, noticeRepo };
}

const mark = (over: any = {}) => ({
  congregationId: 'cong-1',
  userId: 'u1',
  itemType: 'part',
  itemId: 'a1',
  meetingDate: MEETING,
  meetingKind: 'midweek',
  labelKey: 'bible_reading',
  labelTitle: null,
  assistant: false,
  slot: null,
  ...over,
});

describe('the evening digest', () => {
  it('tells a part nobody announced as an assignment, and remembers it', async () => {
    const { svc, sent, marks } = build({});

    await svc.sendDigests('cong-1', '2026-10-15'); // 7 days before

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Вам назначено');
    expect(sent[0].kind).toBe('assignment_reminder');
    // A person with no device gets it by post.
    expect(sent[0].emailFallback).toBe(true);
    expect(marks).toHaveLength(1);
  });

  it('recalls it the evening before as «Завтра у вас»', async () => {
    const { svc, sent } = build({ marks: [mark()] });

    await svc.sendDigests('cong-1', '2026-10-21');

    expect(sent[0].title).toBe('Завтра у вас');
  });

  it('is one message a person an evening: the key carries the day', async () => {
    const { svc, sent } = build({ marks: [mark()] });

    await svc.sendDigests('cong-1', '2026-10-21');

    expect(sent[0].key).toBe('digest:2026-10-21:u1');
  });

  it('says nothing on an evening that is no step', async () => {
    const { svc, sent } = build({ marks: [mark()] });

    await svc.sendDigests('cong-1', '2026-10-17'); // 5 days

    expect(sent).toEqual([]);
  });

  it('keeps to the short ladder when the person chose it', async () => {
    const { svc, sent } = build({ marks: [mark()], ladder: 'short' });

    await svc.sendDigests('cong-1', '2026-10-19'); // 3 days: not on the short one

    expect(sent).toEqual([]);
  });

  it('tells whoever was told that the part is no longer theirs', async () => {
    const { svc, sent, marks } = build({ marks: [mark()], parts: [] });

    await svc.sendDigests('cong-1', '2026-10-17');

    expect(sent[0].title).toBe('Назначение отменено');
    expect(marks).toEqual([]);
  });

  it('numbers a microphone only when there are several', async () => {
    const duty = (id: string, slotIndex: number, publisherId: string) => ({
      id,
      weekStartDate: MON,
      eventType: 'midweek',
      dutyType: 'microphone',
      slotIndex,
      customLabel: null,
      publisherId,
    });
    const { svc, sent } = build({
      parts: [],
      duties: [duty('d1', 0, 'p1'), duty('d2', 1, 'p2')],
    });

    await svc.sendDigests('cong-1', '2026-10-21');

    expect(sent[0].body).toContain('Микрофон 1');
  });

  it('drops marks of meetings that have passed, without a word', async () => {
    const { svc, sent, marks } = build({
      marks: [mark({ itemId: 'old', meetingDate: '2026-10-01' })],
      parts: [],
    });

    await svc.sendDigests('cong-1', '2026-10-17');

    expect(sent).toEqual([]);
    expect(marks).toEqual([]);
  });
});

describe('said at once', () => {
  it('a meeting announced now is remembered, so the ladder only recalls it', async () => {
    const { svc, marks, sent } = build({});

    await svc.markTold('cong-1', MON, 'midweek', [
      {
        id: 'a1',
        partKey: 'bible_reading',
        partTitle: null,
        publisherId: 'p1',
        assistantPublisherId: null,
      } as any,
    ]);
    await svc.sendDigests('cong-1', '2026-10-15');

    expect(marks).toHaveLength(1);
    expect(sent[0].title).toBe('Ваши ближайшие задания');
  });
});

describe('the evening the ladder would speak by itself', () => {
  const next = (today: string, minutes: number, steps = [21, 14, 7, 3, 1]) =>
    AssignmentRemindersService.nextWord({
      today,
      minutes,
      meetingDate: MEETING,
      steps,
    });

  it('is the next step down', () => {
    expect(next('2026-10-12', 600)).toBe('2026-10-15'); // 10 days → at 7
  });

  it('is tonight when today is a step and the digest has not gone', () => {
    expect(next('2026-10-19', 17 * 60)).toBe('2026-10-19'); // 3 days, 17:00
  });

  it("is the following step once tonight's digest has gone", () => {
    expect(next('2026-10-19', 18 * 60 + 5)).toBe('2026-10-21');
  });

  // The window must not offer «не сейчас» here: nobody would hear in time.
  it('is never, the evening before after six and on the day itself', () => {
    expect(next('2026-10-21', 18 * 60 + 5)).toBeNull();
    expect(next('2026-10-22', 9 * 60)).toBeNull();
  });
});

describe('the window after an edit', () => {
  const changed = {
    id: 'a1',
    weekStartDate: MON,
    eventType: 'midweek',
    partKey: 'bible_reading',
    partTitle: null,
    partOrder: 1,
    publisherId: 'p1',
    assistantPublisherId: null,
    status: 'published',
    deletedAt: null,
    changedSincePublish: true,
  };

  it('names who would hear, what, and by which road', async () => {
    const { svc } = build({ parts: [changed] });

    const res = await svc.pendingNotice(
      'cong-1',
      MON,
      'midweek',
      new Date('2026-10-12T08:00:00Z'),
    );

    expect(res.rows).toEqual([
      {
        publisherId: 'p1',
        displayName: 'Бойко Виктор',
        tone: 'assigned',
        label: 'Чтение Библии',
        reach: 'email', // no device registered, but an address
        nextWord: '2026-10-15',
      },
    ]);
    expect(res.canWait).toBe(true);
    expect(res.nextWord).toBe('2026-10-15');
  });

  it('says a device takes it when there is one', async () => {
    const { svc } = build({ parts: [changed], tokens: [{ userId: 'u1' }] });

    const res = await svc.pendingNotice(
      'cong-1',
      MON,
      'midweek',
      new Date('2026-10-12T08:00:00Z'),
    );

    expect(res.rows[0].reach).toBe('push');
  });

  it('does not allow waiting when no evening is left', async () => {
    const { svc } = build({ parts: [changed] });

    // The evening before, 19:30 in Berlin: tonight's digest has gone.
    const res = await svc.pendingNotice(
      'cong-1',
      MON,
      'midweek',
      new Date('2026-10-21T17:30:00Z'),
    );

    expect(res.canWait).toBe(false);
  });
});
