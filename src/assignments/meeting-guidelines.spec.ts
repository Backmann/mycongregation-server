import fixtures from './meeting-guidelines.fixtures.json';
import {
  guidelineRefusal,
  isLocalNeeds,
  ministryKind,
  type GuidelinePerson,
} from './meeting-guidelines';

const brother = (
  appointment = 'publisher',
  capabilities = {},
): GuidelinePerson => ({
  gender: 'brother',
  appointment,
  capabilities,
});
const sister = (
  appointment = 'publisher',
  capabilities = {},
): GuidelinePerson => ({
  gender: 'sister',
  appointment,
  capabilities,
});

describe('meeting guidelines — kind of a ministry part', () => {
  it.each(fixtures.kinds as [string, string][])('«%s» → %s', (title, kind) => {
    expect(ministryKind(title)).toBe(kind);
  });
  it.each(fixtures.localNeeds as [string, boolean][])(
    'local needs «%s» → %s',
    (title, yes) => {
      expect(isLocalNeeds(title)).toBe(yes);
    },
  );
});

describe('meeting guidelines — who may take a part', () => {
  it('Bible reading: a brother only (п. 5)', () => {
    expect(guidelineRefusal('bible_reading', null, sister(), null)).toBe(
      'PART_NEEDS_BROTHER',
    );
    expect(guidelineRefusal('bible_reading', null, brother(), null)).toBeNull();
  });
  it('a student talk: a brother, no assistant (п. 11, 12)', () => {
    expect(guidelineRefusal('apply_yourself_4', 'Речь', sister(), null)).toBe(
      'PART_NEEDS_BROTHER',
    );
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        'Объясняйте свои взгляды: Речь. ijwfq',
        brother(),
        brother(),
      ),
    ).toBe('PART_NO_ASSISTANT');
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        'Объясняйте свои взгляды: Демонстрация.',
        sister(),
        sister(),
      ),
    ).toBeNull();
  });
  it('assistant of the other gender: family allowed for п. 7 and 11 only', () => {
    expect(
      guidelineRefusal(
        'apply_yourself_1',
        'Начинайте разговор',
        sister(),
        brother(),
      ),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        'Объясняйте свои взгляды',
        brother(),
        sister(),
      ),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'apply_yourself_2',
        'Развивайте интерес',
        sister(),
        brother(),
      ),
    ).toBe('ASSISTANT_SAME_GENDER');
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        'Подготавливайте учеников',
        brother(),
        sister(),
      ),
    ).toBe('ASSISTANT_SAME_GENDER');
    expect(
      guidelineRefusal(
        'apply_yourself_2',
        'Тестовый пункт',
        sister(),
        brother(),
      ),
    ).toBe('ASSISTANT_SAME_GENDER');
  });
  it('a discussion: an elder or servant, no assistant (п. 6, 9)', () => {
    const t = 'Что бы вы сказали?: Обсуждение.';
    expect(guidelineRefusal('apply_yourself_3', t, brother(), null)).toBe(
      'PART_NEEDS_ELDER_OR_SERVANT',
    );
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        t,
        brother('ministerial_servant'),
        null,
      ),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'apply_yourself_3',
        t,
        brother('elder'),
        brother('elder'),
      ),
    ).toBe('PART_NO_ASSISTANT');
  });
  it('Christian life: elder or servant; local needs: elder (п. 16)', () => {
    expect(
      guidelineRefusal('living_christians_1', 'Любовь', brother(), null),
    ).toBe('PART_NEEDS_ELDER_OR_SERVANT');
    expect(
      guidelineRefusal(
        'living_christians_1',
        'Любовь',
        brother('ministerial_servant'),
        null,
      ),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'living_christians_2',
        'Местные потребности',
        brother('ministerial_servant'),
        null,
      ),
    ).toBe('PART_NEEDS_ELDER');
    expect(
      guidelineRefusal(
        'living_christians_extra',
        'Тема',
        brother('ministerial_servant'),
        null,
        true,
        true,
        true,
      ),
    ).toBe('PART_NEEDS_ELDER');
    expect(
      guidelineRefusal(
        'living_christians_2',
        'Местные потребности',
        brother('elder'),
        null,
      ),
    ).toBeNull();
  });
  it('Treasures, gems, chairman, study: elder or servant (п. 3, 4, 17, 25)', () => {
    for (const k of [
      'treasures_talk',
      'spiritual_gems',
      'midweek_chairman',
      'cbs_conductor',
    ]) {
      expect(guidelineRefusal(k, null, brother(), null)).toBe(
        'PART_NEEDS_ELDER_OR_SERVANT',
      );
      expect(
        guidelineRefusal(k, null, brother('ministerial_servant'), null),
      ).toBeNull();
    }
  });
  it('a student who is not a publisher: only with the mark of the part (п. 1)', () => {
    expect(
      guidelineRefusal('bible_reading', null, brother('student'), null),
    ).toBe('STUDENT_NOT_APPROVED');
    expect(
      guidelineRefusal(
        'bible_reading',
        null,
        brother('student', { bible_reading: true }),
        null,
      ),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'apply_yourself_1',
        'Начинайте разговор',
        sister(),
        sister('student', { fs_following_up: true }),
      ),
    ).toBe('STUDENT_NOT_APPROVED');
    expect(
      guidelineRefusal(
        'apply_yourself_1',
        'Начинайте разговор',
        sister(),
        sister('student', { fs_starting_conversation: true }),
      ),
    ).toBeNull();
  });
  it('people already on the part are not checked again', () => {
    expect(
      guidelineRefusal('bible_reading', null, sister(), null, false, false),
    ).toBeNull();
    expect(
      guidelineRefusal(
        'apply_yourself_2',
        'Развивайте интерес',
        sister(),
        brother(),
        false,
        false,
      ),
    ).toBeNull();
  });
  it('the weekend and other parts are left alone', () => {
    expect(
      guidelineRefusal('watchtower_reader', null, sister(), null),
    ).toBeNull();
    expect(
      guidelineRefusal('weekend_hospitality', null, sister(), null),
    ).toBeNull();
  });
});
