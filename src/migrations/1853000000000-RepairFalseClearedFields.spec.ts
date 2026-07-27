import { RepairFalseClearedFields1853000000000 } from './1853000000000-RepairFalseClearedFields';

/**
 * The migration is exercised against a stand-in for the database, so the
 * decision it makes can be checked without a live server: which claims are
 * impossible, and what survives in a row it touches.
 */
describe('RepairFalseClearedFields', () => {
  function makeRunner(rows: any[]) {
    const updates: any[][] = [];
    const query = jest.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('information_schema')) {
        // special_events: title and date may never be empty; type may.
        return params?.[0] === 'special_events'
          ? [{ column_name: 'title' }, { column_name: 'date' }]
          : [];
      }
      if (sql.includes('SELECT id, changed_fields')) {
        return params?.[0] === 'special_event' ? rows : [];
      }
      if (sql.startsWith('UPDATE "audit_logs"\n              SET')) {
        updates.push(params ?? []);
      }
      return [];
    });
    return { runner: { query } as any, updates };
  }

  it('drops a claim the schema could never have allowed, and keeps the real change', async () => {
    const { runner, updates } = makeRunner([
      {
        id: 'a1',
        changed_fields: ['title', 'date', 'time'],
        before_json: JSON.stringify({
          title: 'Посещение',
          date: '2026-08-04',
          time: null,
        }),
        after_json: JSON.stringify({
          title: null,
          date: null,
          time: '10:00',
        }),
      },
    ]);

    await new RepairFalseClearedFields1853000000000().up(runner);

    expect(updates).toHaveLength(1);
    const [, fields, before, after] = updates[0];
    expect(fields).toEqual(['time']);
    expect(JSON.parse(after)).toEqual({ time: '10:00' });
    expect(JSON.parse(before)).toEqual({ time: null });
  });

  it('leaves a nullable field alone — clearing it may really have happened', async () => {
    const { runner, updates } = makeRunner([
      {
        id: 'a2',
        changed_fields: ['type'],
        before_json: JSON.stringify({ type: 'memorial' }),
        after_json: JSON.stringify({ type: null }),
      },
    ]);

    await new RepairFalseClearedFields1853000000000().up(runner);

    expect(updates).toHaveLength(0);
  });

  it('a row with nothing provable left keeps its actor and time, and says only «изменил»', async () => {
    const { runner, updates } = makeRunner([
      {
        id: 'a3',
        changed_fields: ['title'],
        before_json: JSON.stringify({ title: 'Посещение' }),
        after_json: JSON.stringify({ title: null }),
      },
    ]);

    await new RepairFalseClearedFields1853000000000().up(runner);

    const [, fields, before, after] = updates[0];
    expect(fields).toEqual([]);
    expect(before).toBeNull();
    expect(after).toBeNull();
  });

  it('never touches a row whose claims are all genuine', async () => {
    const { runner, updates } = makeRunner([
      {
        id: 'a4',
        changed_fields: ['title'],
        before_json: JSON.stringify({ title: 'Старое' }),
        after_json: JSON.stringify({ title: 'Новое' }),
      },
    ]);

    await new RepairFalseClearedFields1853000000000().up(runner);

    expect(updates).toHaveLength(0);
  });
});
