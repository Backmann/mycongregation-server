import { isStudentPart, lessonOf, settingOf } from './student-part';

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
});
