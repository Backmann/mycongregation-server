import { anonymise, findLeaks, type Row, type Tables } from './anonymise';
import { NameMap } from './names';
import { PLAN, type Rule, type TablePlan } from './plan';

/**
 * Invented «real» data. Every personal value carries a mark, so that a single
 * search of the finished copy tells whether anything came through.
 */
const SURNAME = 'Живоймаркеров';
const FIRST = 'Живоймаркер';
const MARK = /живоймаркер|zhivoy|\+49|enc:v1/i;
const ID = '11111111-2222-4333-8444-555555555555';

function marked(rule: Rule, n: number): unknown {
  switch (rule) {
    case 'copy':
      return ID;
    case 'first':
    case 'wife':
      return FIRST;
    case 'last':
      return SURNAME;
    case 'full':
      return `${FIRST} ${SURNAME}`;
    case 'scrub':
      return `Речь, которую произнесёт ${SURNAME}`;
    case 'url':
      return `https://zhivoy.example/${n}`;
    case 'time':
      return `у ${SURNAME} в 10:00`;
    case 'email':
      return `zhivoy${n}@mail.example`;
    case 'login':
      return `zhivoy${n}`;
    case 'false':
      return true;
    case 'revert':
      return [
        {
          op: 'field',
          id: ID,
          field: 'speakerName',
          prev: `${FIRST} ${SURNAME}`,
        },
        { op: 'field', id: ID, field: 'partTitle', prev: `Гость — ${SURNAME}` },
        { op: 'field', id: ID, field: 'partDurationMin', prev: 30 },
        {
          op: 'speaker',
          id: ID,
          prev: {
            publisherId: ID,
            speakerName: `${FIRST} ${SURNAME}`,
            speakerCongregation: `Собрание ${SURNAME}`,
            partTitle: `Тема ${SURNAME}`,
            specialTalk: false,
            whatever: SURNAME,
          },
        },
        { op: 'unknown-later', note: SURNAME },
        { op: 'meeting', kind: 'weekend' },
      ];
    case 'merge':
      return { at: '2026-01-01T00:00:00Z', filled: ['phone'], was: SURNAME };
    default:
      // «null» and every label: text a person typed, with a name and a phone.
      return `enc:v1:${SURNAME} +49 151 0000000 ${n}`;
  }
}

/** One row for every planned table, every field filled by its rule. */
function everything(plan: Record<string, TablePlan> = PLAN): Tables {
  const source: Tables = {};
  let n = 0;
  for (const [table, tablePlan] of Object.entries(plan)) {
    const row: Row = {};
    if (tablePlan === 'skip') {
      row.before_json = `${FIRST} ${SURNAME}`;
    } else {
      for (const [column, rule] of Object.entries(tablePlan)) {
        row[column] = marked(rule, ++n);
      }
    }
    source[table] = [row, { ...row }];
  }
  return source;
}

describe('anonymise', () => {
  it('lets nothing personal through, in any field of the plan', () => {
    const { tables, leaks } = anonymise(everything());
    expect(leaks).toEqual([]);
    const text = JSON.stringify(tables);
    expect(text).not.toMatch(MARK);
    // …and it did copy: the links between records are all there.
    expect(text.split(ID).length).toBeGreaterThan(300);
  });

  it('leaves out the tables that are not copied', () => {
    const { tables } = anonymise(everything());
    for (const [table, tablePlan] of Object.entries(PLAN)) {
      expect(table in tables).toBe(tablePlan !== 'skip');
    }
  });

  it('gives every row every planned field, and no other', () => {
    const source = everything();
    source.publishers[0].smuggled = SURNAME;
    const { tables } = anonymise(source);
    expect(Object.keys(tables.publishers[0]).sort()).toEqual(
      Object.keys(PLAN.publishers).sort(),
    );
  });

  describe('the check that reads the finished copy', () => {
    /** The plan with one decision made wrong. */
    function wrong(table: string, column: string): Record<string, TablePlan> {
      return {
        ...PLAN,
        [table]: { ...(PLAN[table] as Record<string, Rule>), [column]: 'copy' },
      };
    }
    const real = new Map([
      [SURNAME.toLowerCase(), 'last' as const],
      [FIRST.toLowerCase(), 'male' as const],
    ]);

    it.each([
      ['assignments', 'speaker_name', 'name'],
      ['publishers', 'display_name', 'name'],
      ['special_events', 'title', 'name'],
      ['talk_exchange', 'note', 'name'],
      ['publishers', 'mobile_phone', 'ciphertext'],
      ['users', 'email', 'address'],
    ])('catches %s.%s copied by mistake', (table, column, what) => {
      const plan = wrong(table, column);
      const source = everything();
      // The value a field of that kind really holds.
      for (const row of source[table]) {
        const rule = (PLAN[table] as Record<string, Rule>)[column];
        row[column] = marked(rule, 7);
      }
      const { leaks } = anonymise(source, plan);
      expect(leaks).toContainEqual(
        expect.objectContaining({ table, column, what }),
      );
    });

    it('catches a surname in a title, but not a first name', () => {
      const copy: Tables = {
        assignments: [
          { part_title: `Чему учит ${FIRST}` },
          { part_title: `Речь: ${SURNAME}` },
          { part_title: `слово ${SURNAME.toLowerCase()} не имя` },
        ],
      };
      const plan = { assignments: { part_title: 'scrub' as Rule } };
      expect(findLeaks(copy, real, plan)).toEqual([
        { table: 'assignments', column: 'part_title', what: 'name', count: 1 },
      ]);
    });

    it('does not read catalogues, ids and dates as names', () => {
      const names = new Map([
        ['вера', 'female' as const],
        ['ada', 'female' as const],
        ['t', 'last' as const],
      ]);
      const copy: Tables = {
        songs: [{ title: 'Вера и дела' }],
        duties: [
          {
            id: '0ada0000-0000-4000-8000-00000000ada0',
            created_at: '2026-10-06T10:00:00+02:00',
            week_start_date: '2026-10-05',
          },
        ],
      };
      const plan: Record<string, TablePlan> = {
        songs: { title: 'copy' },
        duties: { id: 'copy', created_at: 'copy', week_start_date: 'copy' },
      };
      expect(findLeaks(copy, names, plan)).toEqual([]);
    });

    it('does not take its own stand-ins for names', () => {
      const { tables, leaks } = anonymise({
        assignments: [
          {
            speaker_name: 'Петров, собрание Юг',
            speaker_congregation: 'Юг',
            part_title: null,
          },
        ],
        special_events: [
          { type: 'other', title: 'x', co_last_name: 'Событие' },
        ],
      });
      expect(tables.assignments[0].speaker_congregation).toBe('Собрание 1');
      expect(tables.special_events[0].title).toBe('Событие');
      expect(leaks).toEqual([]);
    });

    it('catches a field and a table the plan does not have', () => {
      const copy: Tables = { halls: [{ name: 'Зал 1', extra: 1 }], x: [{}] };
      const plan: Record<string, TablePlan> = { halls: { name: 'label:Зал' } };
      expect(findLeaks(copy, new Map(), plan)).toEqual([
        { table: 'halls', column: 'extra', what: 'unplanned', count: 1 },
        { table: 'x', column: '*', what: 'unplanned', count: 1 },
      ]);
    });

    it('never says what it found', () => {
      const { leaks } = anonymise(
        everything(),
        wrong('publishers', 'display_name'),
      );
      expect(leaks.length).toBeGreaterThan(0);
      expect(JSON.stringify(leaks)).not.toMatch(MARK);
    });
  });

  describe('names', () => {
    const people: Tables = {
      publishers: [
        {
          first_name: 'Иван',
          last_name: 'Петров',
          display_name: 'Петров Иван',
          gender: 'brother',
        },
        {
          first_name: 'Мария',
          last_name: 'Петрова',
          display_name: 'ПЕТРОВА Мария',
          gender: 'sister',
        },
        {
          first_name: 'Иван',
          last_name: 'Сидоров',
          display_name: 'Сидоров Иван',
          gender: 'brother',
        },
      ],
      visiting_speakers: [{ first_name: 'Олег', last_name: 'Кузнецов' }],
      circuit_overseers: [
        { first_name: 'Олег', last_name: 'Кузнецов', wife_name: 'Нина' },
      ],
      special_events: [
        {
          type: 'circuit_overseer_visit',
          title: 'Визит: Кузнецов',
          co_first_name: 'Олег',
          co_last_name: 'Кузнецов',
          co_wife_name: 'Нина',
        },
      ],
      assignments: [
        { speaker_name: 'Олег Кузнецов', part_title: 'Петров читает о вере' },
        { speaker_name: 'олег  кузнецов', part_title: null },
        { speaker_name: 'Пётр Новиков', part_title: 'Иван и Мария' },
      ],
    };
    const { tables: t, leaks } = anonymise(people);
    const [a, b, c] = t.publishers;

    it('passes its own check', () => expect(leaks).toEqual([]));

    it('gives one real word one invented word, everywhere', () => {
      expect(a.first_name).toBe(c.first_name);
      expect(a.display_name).toBe(
        `${String(a.last_name)} ${String(a.first_name)}`,
      );
      const overseer = `${String(t.circuit_overseers[0].first_name)} ${String(t.circuit_overseers[0].last_name)}`;
      expect(t.assignments[0].speaker_name).toBe(overseer);
      expect(
        `${String(t.visiting_speakers[0].first_name)} ${String(t.visiting_speakers[0].last_name)}`,
      ).toBe(overseer);
      expect(
        `${String(t.special_events[0].co_first_name)} ${String(t.special_events[0].co_last_name)}`,
      ).toBe(overseer);
      expect(t.special_events[0].co_wife_name).toBe(
        t.circuit_overseers[0].wife_name,
      );
    });

    it('keeps different people different', () => {
      const words = [
        a.first_name,
        b.first_name,
        a.last_name,
        b.last_name,
        c.last_name,
        t.visiting_speakers[0].first_name,
        t.visiting_speakers[0].last_name,
      ];
      expect(new Set(words).size).toBe(words.length);
    });

    it('keeps the case and the spaces, which is how the app compares', () => {
      expect(b.display_name).toBe(
        `${String(b.last_name).toUpperCase()} ${String(b.first_name)}`,
      );
      const spoken = String(t.assignments[0].speaker_name);
      expect(t.assignments[1].speaker_name).toBe(
        spoken.toLowerCase().replace(' ', '  '),
      );
    });

    it('invents nothing that is somebody’s real name', () => {
      const real = [
        'иван',
        'мария',
        'петров',
        'петрова',
        'сидоров',
        'олег',
        'кузнецов',
        'нина',
        'пётр',
        'новиков',
      ];
      const out = JSON.stringify(t).toLowerCase();
      for (const w of real) {
        if (w === 'иван' || w === 'мария') continue; // left in a title, below
        expect(out).not.toContain(w);
      }
    });

    it('takes a surname out of a title and leaves the first names', () => {
      expect(t.assignments[0].part_title).toBe(
        `${String(a.last_name)} читает о вере`,
      );
      expect(t.assignments[2].part_title).toBe('Иван и Мария');
    });

    it('says an event’s title again from its type', () => {
      expect(t.special_events[0].title).toBe('Визит районного старейшины');
    });

    it('does not hand out a word that is real, even from its own list', () => {
      const names = new NameMap();
      names.forbid(['адам', 'альт']);
      names.learn('Иван', 'male');
      names.learn('Петров', 'last');
      expect(names.rename('Иван Петров')).toBe('Альберт Бах');
    });

    it('has a word for more people than its lists are long', () => {
      const names = new NameMap();
      const seen = new Set<string>();
      for (let i = 0; i < 1500; i++)
        seen.add(names.rename(`слово${'а'.repeat(i)}`));
      expect(seen.size).toBe(1500);
      for (const w of seen) expect(w).toMatch(/^\p{L}+$/u);
    });
  });

  describe('stand-ins', () => {
    const { tables: t } = anonymise({
      external_congregations: [
        { name: 'Северное', city: 'Город' },
        { name: 'Южное', city: 'Город' },
      ],
      assignments: [
        { speaker_congregation: 'Северное' },
        { speaker_congregation: ' северное ' },
        { speaker_congregation: 'Третье' },
        { speaker_congregation: null },
      ],
      halls: [{ name: 'Северное', address: 'ул. Настоящая, 1' }],
    });

    it('gives the same value the same stand-in across tables', () => {
      expect(t.external_congregations[0].name).toBe('Собрание 1');
      expect(t.external_congregations[1].name).toBe('Собрание 2');
      expect(t.assignments[0].speaker_congregation).toBe('Собрание 1');
      expect(t.assignments[2].speaker_congregation).toBe('Собрание 3');
      expect(t.external_congregations[0].city).toBe(
        t.external_congregations[1].city,
      );
    });

    it('keeps two spellings two, and still the same to the app', () => {
      const other = String(t.assignments[1].speaker_congregation);
      expect(other).not.toBe('Собрание 1');
      expect(other.trim().toLowerCase()).toBe('собрание 1');
    });

    it('numbers each kind on its own and leaves the empty empty', () => {
      expect(t.halls[0]).toMatchObject({ name: 'Зал 1', address: 'Адрес 1' });
      expect(t.assignments[3].speaker_congregation).toBeNull();
    });
  });

  describe('the rest of the rules', () => {
    const { tables: t } = anonymise({
      publishers: [
        {
          first_name: 'Иван',
          last_name: 'Петров',
          gender: 'brother',
          is_deaf: true,
          is_blind: true,
          is_imprisoned: true,
          birth_date: '1980-05-17',
          mobile_phone: 'enc:v1:x',
        },
      ],
      users: [
        { email: 'a@b.example', login_name: 'petrov1', password_hash: 'h' },
        { email: null, login_name: null },
        { email: 'c@d.example', login_name: 'x' },
      ],
      special_events: [
        {
          type: 'other',
          title: 'У Петрова',
          time: '18:30',
          program_url: 'https://www.jw.org/ru/x',
          memorial_theme_url: 'https://evil.example/jw.org',
          co_revert_data: [
            {
              op: 'speaker',
              id: ID,
              prev: {
                publisherId: ID,
                speakerName: 'Иван Петров',
                partTitle: null,
              },
            },
            { op: 'later' },
          ],
        },
        {
          type: 'party',
          title: 'x',
          time: 'после встречи у Петрова',
          program_url: 'http://wol.jw.org',
          co_revert_data: null,
        },
      ],
      visiting_speakers: [
        {
          first_name: 'Олег',
          last_name: 'Кузнецов',
          merge_record: { at: 'x', filled: ['note'], secret: 'Петров' },
        },
      ],
    });

    it('keeps the date of birth as it is and clears the three marks', () => {
      expect(t.publishers[0]).toMatchObject({
        birth_date: '1980-05-17',
        is_deaf: false,
        is_blind: false,
        is_imprisoned: false,
        mobile_phone: null,
      });
    });

    it('gives logins that can reach nobody', () => {
      expect(t.users.map((u) => u.email)).toEqual([
        'u1@example.invalid',
        null,
        'u2@example.invalid',
      ]);
      expect(t.users.map((u) => u.login_name)).toEqual([
        'user1',
        null,
        'user2',
      ]);
      expect(t.users[0].password_hash).toBeNull();
    });

    it('keeps a link to jw.org and a clock time, and nothing else', () => {
      expect(t.special_events[0]).toMatchObject({
        title: 'Событие',
        time: '18:30',
        program_url: 'https://www.jw.org/ru/x',
        memorial_theme_url: null,
      });
      expect(t.special_events[1]).toMatchObject({
        title: 'Встреча собрания',
        time: null,
        program_url: 'http://wol.jw.org',
      });
    });

    it('keeps the undo plan of a visit usable, with the names replaced', () => {
      const name = `${String(t.publishers[0].first_name)} ${String(t.publishers[0].last_name)}`;
      expect(t.special_events[0].co_revert_data).toEqual([
        {
          op: 'speaker',
          id: ID,
          prev: { publisherId: ID, speakerName: name, partTitle: null },
        },
      ]);
      expect(t.special_events[1].co_revert_data).toBeNull();
    });

    it('keeps the known keys of a merge record only', () => {
      expect(t.visiting_speakers[0].merge_record).toEqual({
        at: 'x',
        filled: ['note'],
      });
    });
  });
});
