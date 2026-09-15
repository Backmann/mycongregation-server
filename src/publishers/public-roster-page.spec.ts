import { publicRosterPage } from './publisher-privacy';

// The group endpoint hid students while the publishers list did not, so the
// same person was hidden in one place and shown in the other.
describe('publicRosterPage', () => {
  const page = {
    data: [
      {
        id: 'p1',
        displayName: 'A',
        appointment: 'publisher',
        mobilePhone: '+49 1',
        pioneerType: 'regular',
        pioneerSince: '2099-08-01',
      },
      { id: 'p2', displayName: 'S', appointment: 'student' },
    ],
    total: 2,
    limit: 50,
    offset: 0,
  };

  it('leaves students out and keeps the count honest', () => {
    const out = publicRosterPage(page);
    expect(out.data.map((p) => p.id)).toEqual(['p1']);
    expect(out.total).toBe(1);
  });

  it('still redacts and still answers the pioneer question', () => {
    const out = publicRosterPage(page) as any;
    expect(out.data[0].mobilePhone).toBeUndefined();
    expect(out.data[0].pioneerSince).toBeUndefined();
    expect(out.data[0].pioneerActive).toBe(false);
  });

  /**
   * Решение Лионеля 15 сентября: обычный возвещатель не видит ни изучающих,
   * ни неактивных. Первое было с самого начала, второго не было.
   */
  it('прячет неактивных', () => {
    const out = publicRosterPage({
      data: [
        {
          id: 'a',
          displayName: 'Активный',
          appointment: 'publisher',
          status: 'active',
        },
        {
          id: 'i',
          displayName: 'Неактивный',
          appointment: 'publisher',
          status: 'inactive',
        },
      ],
      total: 2,
    });

    expect(out.data.map((p) => p.id)).toEqual(['a']);
    // Счёт следует за списком, иначе цифра спорит с тем, что на экране.
    expect(out.total).toBe(1);
  });

  it('нерегулярных оставляет', () => {
    // Он служит, просто с перерывами, и на доске объявлений он есть.
    const out = publicRosterPage({
      data: [
        {
          id: 'r',
          displayName: 'Нерегулярный',
          appointment: 'publisher',
          status: 'irregular',
        },
      ],
      total: 1,
    });

    expect(out.data.map((p) => p.id)).toEqual(['r']);
  });
});
