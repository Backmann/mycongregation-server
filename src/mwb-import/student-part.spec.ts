import { isStudentPart, lessonOf, settingOf } from './student-part';
import { StudentLessonSetting1940000000000 } from '../migrations/1940000000000-StudentLessonSetting';

describe('the lesson and the setting of a student part', () => {
  it('THE CASE: a talk-with-setting title gives both', () => {
    const t =
      'Начинайте разговор: ПРОПОВЕДЬ ПО ДОМАМ. Текст задания для проверки. (lmd урок 2, пункт 3)';
    expect(lessonOf(t)).toBe('lmd урок 2, пункт 3');
    expect(settingOf(t)).toBe('house');
  });

  it('the Bible reading: a lesson, no setting', () => {
    const t = 'Чтение Библии: Тест 1:1–10 (th урок 10)';
    expect(lessonOf(t)).toBe('th урок 10');
    expect(settingOf(t)).toBeNull();
  });

  it('the three settings the workbook uses', () => {
    expect(settingOf('Развивайте интерес: НЕФОРМАЛЬНОЕ СЛУЖЕНИЕ. …')).toBe(
      'informal',
    );
    expect(
      settingOf('Начинайте разговор: ПРОПОВЕДЬ В ОБЩЕСТВЕННЫХ МЕСТАХ. …'),
    ).toBe('public');
    // The workbook's text itself, without the part's name in front.
    expect(settingOf('ПО ДОМАМ. Расскажите…')).toBe('house');
  });

  it('a title cut before its end has no lesson — nothing is invented', () => {
    expect(
      lessonOf('Развивайте интерес: ПРОПОВЕДЬ ПО ДОМАМ. Длинный текст (lmd ур'),
    ).toBeNull();
  });

  it('capitals that are no setting, and a talk with none, give no setting', () => {
    expect(settingOf('Речь: Тема речи. (th урок 7)')).toBeNull();
    expect(settingOf('Что бы вы сказали?: ВИДЕО. …')).toBeNull();
    expect(settingOf(null)).toBeNull();
  });

  it('two references: the lesson is the last one, where the workbook puts it', () => {
    // Not seen in a workbook yet; the part's own lesson closes its text.
    expect(lessonOf('Речь: Тема (th урок 3) по статье (th урок 14)')).toBe(
      'th урок 14',
    );
    expect(lessonOf('Речь: Тема (см. Мф 5:3) (th урок 14)')).toBe('th урок 14');
  });

  it('only the parts a student is given', () => {
    expect(isStudentPart('bible_reading')).toBe(true);
    expect(isStudentPart('apply_yourself_4')).toBe(true);
    expect(isStudentPart('apply_yourself')).toBe(false);
    expect(isStudentPart('treasures_talk')).toBe(false);
  });

  it('the raw text with a colon of its own gives what its stored title gives', () => {
    // 18 of 175 live titles hold a colon inside the assignment.
    const raw =
      'ПРОПОВЕДЬ ПО ДОМАМ. Покажите, как ответить на возражение: «Я занят». (lmd урок 3, пункт 4)';
    expect(settingOf(raw)).toBe('house');
    expect(settingOf(`Начинайте разговор: ${raw}`)).toBe('house');
  });
});

describe('the migration fills stored titles by the same rules', () => {
  const titles = [
    'Чтение Библии: Тест 1:1–10 (th урок 2)',
    'Начинайте разговор: ПРОПОВЕДЬ ПО ДОМАМ. Ответ на возражение: «Я занят». (lmd урок 3, пункт 4)',
    'Развивайте интерес: НЕФОРМАЛЬНОЕ СЛУЖЕНИЕ. Текст, обрезанный на ста двадцати знаках (lmd ур',
    'Начинайте разговор: ПРОПОВЕДЬ В ОБЩЕСТВЕННЫХ МЕСТАХ. Коротко. (lmd урок 7, пункт 4)',
    'Речь: Тема. (th урок 7)',
    'Что бы вы сказали?: Обсуждение.',
    // Two references: never seen on the live programme, kept to hold the copies alike.
    'Речь: Тема (th урок 3) по статье (th урок 14)',
  ];
  it('each title gets what student-part.ts says, and a title with neither is left alone', async () => {
    const updates: unknown[][] = [];
    const runner = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT'))
          return titles.map((t, i) => ({ id: `a${i}`, part_title: t }));
        if (sql.startsWith('UPDATE')) updates.push(params ?? []);
        return [];
      }),
    };
    await new StudentLessonSetting1940000000000().up(runner as never);
    const expected = titles
      .map((t, i) => [lessonOf(t), settingOf(t), `a${i}`])
      .filter(([l, st]) => l !== null || st !== null);
    expect(updates).toEqual(expected);
    expect(updates).toHaveLength(6);
  });
});
