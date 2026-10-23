import { planSlot } from '../../talk-exchange/incoming-slot-plan';

const base = {
  slot_id: 's1',
  slot_status: 'published',
  slot_talk_id: null,
  slot_special: false,
  slot_title: null,
  publisher_id: null,
  visiting_speaker_id: null,
  vs_name: null,
  vs_cong: null,
  speaker_name: null,
  speaker_congregation: null,
  public_talk_id: null,
  talk_label: null,
  special_theme: null,
};

describe('IncomingSpeakersIntoProgramme — what an empty line becomes', () => {
  it('a visiting speaker without a talk yet is named, and the line keeps its talk', () => {
    const plan = planSlot({
      ...base,
      slot_talk_id: 't9',
      slot_title: '№9. Тема',
      visiting_speaker_id: 'v1',
      vs_name: 'Томас Шульц',
      vs_cong: 'Unna',
    });
    expect(plan).toEqual({
      publisherId: null,
      speakerName: 'Томас Шульц',
      speakerCongregation: 'Unna',
      visitingSpeakerId: 'v1',
      publicTalkId: 't9',
      partTitle: '№9. Тема',
      specialTalk: false,
    });
  });

  it('a name typed by hand goes in when there is no card behind it', () => {
    const plan = planSlot({
      ...base,
      speaker_name: ' Иван Петров ',
      speaker_congregation: 'Dortmund',
    });
    expect(plan?.speakerName).toBe('Иван Петров');
    expect(plan?.speakerCongregation).toBe('Dortmund');
    expect(plan?.visitingSpeakerId).toBeNull();
  });

  it('our own brother is named by his card, not by text', () => {
    const plan = planSlot({ ...base, publisher_id: 'p1', speaker_name: 'x' });
    expect(plan?.publisherId).toBe('p1');
    expect(plan?.speakerName).toBeNull();
  });

  it('the talk of the entry goes in with the speaker into an empty line', () => {
    const plan = planSlot({
      ...base,
      vs_name: 'Томас Шульц',
      public_talk_id: 't3',
      talk_label: '№3. Тема',
    });
    expect(plan?.publicTalkId).toBe('t3');
    expect(plan?.partTitle).toBe('№3. Тема');
  });

  it('another talk already in the line is somebody’s choice — left alone', () => {
    expect(
      planSlot({
        ...base,
        slot_talk_id: 't9',
        vs_name: 'Томас Шульц',
        public_talk_id: 't3',
      }),
    ).toBeNull();
  });

  it('an entry with neither speaker nor talk changes nothing', () => {
    expect(planSlot({ ...base })).toBeNull();
  });
});
