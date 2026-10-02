import {
  DigestLine,
  ReminderItem,
  ReminderMark,
  planDigest,
  writeDigest,
} from './digest';

const part = (over: Partial<ReminderItem> = {}): ReminderItem => ({
  type: 'part',
  id: 'a1',
  date: '2026-10-22',
  kind: 'midweek',
  labelKey: 'bible_reading',
  labelTitle: null,
  assistant: false,
  slot: null,
  ...over,
});
const markOf = (i: ReminderItem): ReminderMark => ({ ...i });

/** The evenings on which a line is produced for an item on the 22nd. */
function evenings(item: ReminderItem, ladder: 'full' | 'short', told = true) {
  const out: number[] = [];
  for (let d = 30; d >= 0; d--) {
    const today = new Date(Date.parse('2026-10-22T00:00:00Z') - d * 864e5)
      .toISOString()
      .slice(0, 10);
    const plan = planDigest({
      today,
      ladder,
      items: [item],
      marks: told ? [markOf(item)] : [],
    });
    if (plan.lines.length) out.push(d);
  }
  return out;
}

describe('the ladder', () => {
  // Lionel's own words, 1 October: «за три недели, за две недели, за одну
  // неделю, за три дня и за один день».
  it('recalls a part 21, 14, 7, 3 and 1 day before', () => {
    expect(evenings(part(), 'full')).toEqual([21, 14, 7, 3, 1]);
  });

  it('recalls a duty a week before and the evening before, nothing more', () => {
    expect(
      evenings(part({ type: 'duty', labelKey: 'microphone' }), 'full'),
    ).toEqual([7, 1]);
  });

  it('the short ladder keeps the week and the evening before', () => {
    expect(evenings(part(), 'short')).toEqual([7, 1]);
  });

  it('says nothing on the day itself or after it', () => {
    const plan = planDigest({
      today: '2026-10-22',
      ladder: 'full',
      items: [part()],
      marks: [],
    });
    expect(plan.lines).toEqual([]);
  });
});

describe('the first word about an item', () => {
  // «Применить тихо» is silent now, not for ever: assigned ten days ahead and
  // never announced, the person hears at seven — and hears it as news.
  it('waits for the next step and is said as an assignment', () => {
    const at = (today: string) =>
      planDigest({ today, ladder: 'full', items: [part()], marks: [] });

    expect(at('2026-10-12').lines).toEqual([]); // 10 days: no step
    expect(at('2026-10-13').lines).toEqual([]); // 9 days
    const seven = at('2026-10-15');
    expect(seven.lines).toHaveLength(1);
    expect(seven.lines[0].tone).toBe('new');
    expect(seven.mark).toEqual([part()]);
  });

  it('is a reminder once it has been said', () => {
    const plan = planDigest({
      today: '2026-10-15',
      ladder: 'full',
      items: [part()],
      marks: [markOf(part())],
    });
    expect(plan.lines[0].tone).toBe('reminder');
    expect(plan.mark).toEqual([]);
  });

  it('a step that has passed is not caught up', () => {
    // 20 days ahead: the 21-day step is behind; the next word is at 14.
    const plan = planDigest({
      today: '2026-10-02',
      ladder: 'full',
      items: [part()],
      marks: [],
    });
    expect(plan.lines).toEqual([]);
  });
});

describe('an assignment taken away', () => {
  it('is said to whoever had been told, and the mark is dropped', () => {
    const plan = planDigest({
      today: '2026-10-17',
      ladder: 'full',
      items: [],
      marks: [markOf(part())],
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].tone).toBe('cancelled');
    expect(plan.forget).toEqual([markOf(part())]);
  });

  // Nobody was told, so there is nothing to take back.
  it('is not said to somebody who never heard of it', () => {
    const plan = planDigest({
      today: '2026-10-17',
      ladder: 'full',
      items: [],
      marks: [],
    });
    expect(plan.lines).toEqual([]);
  });

  it('a mark whose day has passed goes without a word', () => {
    const plan = planDigest({
      today: '2026-10-23',
      ladder: 'full',
      items: [],
      marks: [markOf(part())],
    });
    expect(plan.lines).toEqual([]);
    expect(plan.forget).toHaveLength(1);
  });

  it('on any evening, not only on a step', () => {
    // 5 days before is no step of the ladder; a cancellation does not wait.
    const plan = planDigest({
      today: '2026-10-17',
      ladder: 'short',
      items: [],
      marks: [markOf(part())],
    });
    expect(plan.lines[0].tone).toBe('cancelled');
  });
});

describe('a meeting that moved', () => {
  it('moves the mark with it, without a word', () => {
    const moved = part({ date: '2026-10-20' });
    const plan = planDigest({
      today: '2026-10-10',
      ladder: 'full',
      items: [moved],
      marks: [markOf(part())],
    });
    expect(plan.lines).toEqual([]);
    expect(plan.mark).toEqual([moved]);
    expect(plan.forget).toEqual([]);
  });
});

describe('the digest as it is read', () => {
  const line = (
    tone: DigestLine['tone'],
    daysLeft: number,
    over: Partial<ReminderItem> = {},
  ): DigestLine => ({ tone, daysLeft, item: part(over) });

  it('news is headed «Вам назначено» and says how far off it is', () => {
    const t = writeDigest([line('new', 21)], 'ru')!;
    expect(t.title).toBe('Вам назначено');
    expect(t.body).toBe(
      'Чт 22 октября, встреча среди недели: Чтение Библии (через 3 недели)',
    );
  });

  it('the evening before is headed «Завтра у вас»', () => {
    const t = writeDigest(
      [
        line('reminder', 1),
        line('reminder', 1, {
          type: 'duty',
          id: 'd1',
          labelKey: 'microphone',
          slot: 1,
        }),
      ],
      'ru',
    )!;
    expect(t.title).toBe('Завтра у вас');
    expect(t.body.split('\n')).toEqual([
      'Чт 22 октября, встреча среди недели: Чтение Библии',
      'Чт 22 октября, встреча среди недели: Микрофон 1',
    ]);
  });

  it('several things on one evening are one message', () => {
    const t = writeDigest(
      [
        line('reminder', 3, {
          date: '2026-10-11',
          kind: 'weekend',
          labelKey: 'weekend_chairman',
        }),
        line('new', 7, { id: 'a2' }),
      ],
      'ru',
    )!;
    expect(t.title).toBe('Ваши ближайшие задания');
    expect(t.body.split('\n')).toHaveLength(2);
    expect(t.body).toContain('(через 3 дня)');
    // Heard for the first time inside a digest: marked as such.
    expect(t.body).toContain('Новое: ');
  });

  it('a cancellation says there is nothing to prepare', () => {
    const t = writeDigest([line('cancelled', 5)], 'ru')!;
    expect(t.title).toBe('Назначение отменено');
    expect(t.body).toBe('Чт 22 октября: Чтение Библии — готовиться не нужно');
  });

  it('an assistant is told so', () => {
    const t = writeDigest([line('new', 7, { assistant: true })], 'ru')!;
    expect(t.body).toContain('Чтение Библии (помощник)');
  });

  // A student part is called what its title calls it — and only the name of
  // it, not the note the import keeps after the colon.
  it("a student part goes by its title's name, without the note", () => {
    const t = writeDigest(
      [
        line('new', 7, {
          labelKey: 'apply_yourself_2',
          labelTitle: 'Начинайте разговор: (3 мин) ПО ДОМАМ. Используйте…',
        }),
      ],
      'ru',
    )!;
    expect(t.body).toContain(': Начинайте разговор (через неделю)');
    expect(t.body).not.toContain('ПО ДОМАМ');
  });

  // The conductor's title is the article; the prayer's is a song. Neither
  // says what the brother was asked to do.
  it('a role is named as a role, whatever title the part carries', () => {
    const t = writeDigest(
      [
        line('new', 7, {
          kind: 'weekend',
          labelKey: 'watchtower_conductor',
          labelTitle: 'Доверяйте Иегове',
        }),
      ],
      'ru',
    )!;
    expect(t.body).toContain('Изучение «Сторожевой башни» — ведущий');
    expect(t.body).not.toContain('Доверяйте Иегове');
  });

  it('news for tomorrow still says it is tomorrow', () => {
    const t = writeDigest([line('new', 1)], 'ru')!;
    expect(t.title).toBe('Вам назначено');
    expect(t.body).toContain('(завтра)');
  });

  // A raw key at somebody is worse than a plain word.
  it('never prints a key nobody can read', () => {
    const t = writeDigest([line('new', 7, { labelKey: 'zzz_unknown' })], 'ru')!;
    expect(t.body).not.toContain('zzz_unknown');
  });

  it('speaks German and English too', () => {
    expect(writeDigest([line('new', 14)], 'de')!.title).toBe(
      'Dir wurde zugeteilt',
    );
    expect(writeDigest([line('reminder', 1)], 'en')!.title).toBe(
      'Tomorrow you have',
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(writeDigest([], 'ru')).toBeNull();
  });
});
