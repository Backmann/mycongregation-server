import {
  SlotSpeaker,
  leftBeneath,
  overseerInSlot,
  restoreSpeaker,
  speakerOf,
} from './co-visit-speaker';

/**
 * The talk slot in the week of a circuit visit — see co-visit-speaker.ts.
 * The rows are the ones the stand showed on 5 October: one of ours assigned
 * to the public talk, then the visit entered for that week.
 */
const brother = (): SlotSpeaker => ({
  publisherId: 'our-brother',
  speakerName: null,
  speakerCongregation: null,
  visitingSpeakerId: null,
  publicTalkId: 'talk-87',
  specialTalk: false,
  partTitle: '№87. Тема речи брата',
});
const guest = (): SlotSpeaker => ({
  publisherId: null,
  speakerName: 'Пётр Гостев',
  speakerCongregation: 'Соседнее',
  visitingSpeakerId: 'guest-card',
  publicTalkId: 'talk-12',
  specialTalk: false,
  partTitle: '№12. Тема речи гостя',
});

describe('the talk slot under a circuit visit', () => {
  it('holds the overseer and nothing of the speaker before him', () => {
    const slot = brother();
    Object.assign(slot, overseerInSlot('Иван Тестов'));
    expect(slot).toEqual({
      publisherId: null,
      speakerName: 'Иван Тестов',
      speakerCongregation: null,
      visitingSpeakerId: null,
      publicTalkId: null,
      specialTalk: false,
      partTitle: null,
    });
  });

  it.each([
    ['one of ours', brother],
    ['a visiting speaker', guest],
    [
      'a special talk',
      (): SlotSpeaker => ({
        ...guest(),
        publicTalkId: null,
        specialTalk: true,
        partTitle: 'Особая тема',
      }),
    ],
    ['nobody yet', (): SlotSpeaker => speakerOf({})],
  ])('gives the week back to %s exactly as it was', (_, make) => {
    const slot = make();
    const remembered = speakerOf(slot);
    Object.assign(slot, overseerInSlot('Иван Тестов'));
    // While the visit stood, the overseer's own talk was chosen.
    slot.publicTalkId = 'talk-of-the-overseer';
    slot.partTitle = '№5. Речь районного';
    slot.visitingSpeakerId = 'overseer-card';
    restoreSpeaker(slot, remembered);
    expect(slot).toEqual(make());
  });

  it('reads a slot that has not all its fields', () => {
    expect(speakerOf({ publisherId: 'p' })).toEqual({
      publisherId: 'p',
      speakerName: null,
      speakerCongregation: null,
      visitingSpeakerId: null,
      publicTalkId: null,
      specialTalk: false,
      partTitle: null,
    });
  });

  it('puts back only what was remembered', () => {
    const slot = speakerOf({ speakerName: 'Иван Тестов' });
    restoreSpeaker(slot, { publisherId: 'our-brother', publicTalkId: null });
    expect(slot.publisherId).toBe('our-brother');
    // The name was remembered elsewhere and is not this entry's to restore.
    expect(slot.speakerName).toBe('Иван Тестов');
  });
});

describe('a visit laid on the week before the slot was cleared', () => {
  const under = (): SlotSpeaker => ({
    ...brother(),
    speakerName: ' иван  ТЕСТОВ ',
    visitingSpeakerId: 'overseer-card',
  });

  it('finds one of ours still beneath the overseer', () => {
    expect(leftBeneath(under(), 'Иван Тестов')).toEqual({
      publisherId: 'our-brother',
      publicTalkId: 'talk-87',
      specialTalk: false,
      partTitle: '№87. Тема речи брата',
    });
  });

  it('does not take the name: the visit already remembers the one it found', () => {
    expect(leftBeneath(under(), 'Иван Тестов')).not.toHaveProperty(
      'speakerName',
    );
  });

  it('finds nothing where the slot holds the overseer alone', () => {
    expect(
      leftBeneath({ ...under(), publisherId: null }, 'Иван Тестов'),
    ).toBeNull();
  });

  it('leaves a slot that names somebody else', () => {
    expect(leftBeneath(guest(), 'Иван Тестов')).toBeNull();
    expect(leftBeneath(brother(), 'Иван Тестов')).toBeNull();
  });

  it('leaves everything when the visit names nobody', () => {
    expect(leftBeneath(under(), null)).toBeNull();
  });
});
