import { talkAvailability, talkIsRestricted } from './talk-availability';

/**
 * Whether a talk may be given on a given day.
 *
 * Always about a DAY. A talk withdrawn from the first of September is
 * perfectly fine on the last Sunday of August, and one set aside until
 * December is fine in January — answering «снята» to both would make the app
 * wrong twice for every time it is right.
 */
describe('talkAvailability', () => {
  const talk = (
    over: Partial<Parameters<typeof talkAvailability>[0]> = {},
  ) => ({
    isActive: true,
    retiredFrom: null,
    retiredUntil: null,
    ...over,
  });

  it('lets an ordinary talk be given', () => {
    expect(talkAvailability(talk(), '2026-09-13')).toEqual({
      state: 'available',
    });
  });

  it('still lets it be given the day BEFORE it is withdrawn', () => {
    // «начиная с 1 сентября» — the 30th of August is not «начиная с».
    expect(
      talkAvailability(talk({ retiredFrom: '2026-09-01' }), '2026-08-30'),
    ).toEqual({ state: 'available' });
  });

  it('withdraws it from the named day onwards', () => {
    expect(
      talkAvailability(talk({ retiredFrom: '2026-09-01' }), '2026-09-01'),
    ).toEqual({ state: 'withdrawn', from: '2026-09-01' });
    expect(
      talkAvailability(talk({ retiredFrom: '2026-09-01' }), '2027-05-01'),
    ).toEqual({ state: 'withdrawn', from: '2026-09-01' });
  });

  it('pauses it only between the two dates', () => {
    const paused = talk({
      retiredFrom: '2026-09-01',
      retiredUntil: '2026-12-31',
    });

    expect(talkAvailability(paused, '2026-10-04')).toEqual({
      state: 'paused',
      from: '2026-09-01',
      until: '2026-12-31',
    });
    // Both edges belong to the pause: «до 31 декабря» includes it.
    expect(talkAvailability(paused, '2026-12-31').state).toBe('paused');
    expect(talkAvailability(paused, '2026-09-01').state).toBe('paused');
  });

  it('gives it back the day after a pause ends', () => {
    // The whole reason a pause is not a retirement: nobody has to remember to
    // restore it.
    const paused = talk({
      retiredFrom: '2026-09-01',
      retiredUntil: '2026-12-31',
    });

    expect(talkAvailability(paused, '2027-01-01')).toEqual({
      state: 'available',
    });
  });

  it('calls a talk struck out by hand «removed», with no date to show', () => {
    expect(talkAvailability(talk({ isActive: false }), '2026-09-13')).toEqual({
      state: 'removed',
    });
  });

  it('trusts the dates over the flag', () => {
    // A withdrawn talk also has isActive false; before the date it is still
    // to be given, and the date is the more precise fact.
    expect(
      talkAvailability(
        talk({ isActive: false, retiredFrom: '2026-09-01' }),
        '2026-08-15',
      ),
    ).toEqual({ state: 'available' });
  });
});

describe('talkIsRestricted — for lists with no date to ask about', () => {
  it('counts a talk whose pause has not begun', () => {
    // It is about to be set aside; a catalogue read today should say so.
    expect(
      talkIsRestricted(
        { isActive: false, retiredFrom: '2026-09-01', retiredUntil: null },
        '2026-08-01',
      ),
    ).toBe(true);
  });

  it('does not count one whose pause has run out', () => {
    expect(
      talkIsRestricted(
        {
          isActive: false,
          retiredFrom: '2026-09-01',
          retiredUntil: '2026-12-31',
        },
        '2027-02-01',
      ),
    ).toBe(false);
  });

  it('counts one struck out by hand', () => {
    expect(
      talkIsRestricted(
        { isActive: false, retiredFrom: null, retiredUntil: null },
        '2026-08-01',
      ),
    ).toBe(true);
  });
});
