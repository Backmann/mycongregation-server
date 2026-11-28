import { DataSource } from 'typeorm';
import { Harness, startHarness } from './harness';
import { Publisher } from '../../src/entities/publisher.entity';
import {
  invalidWhereValuesBehavior,
  whereValuesMode,
} from '../../src/common/where-values';
import { validationSchema } from '../../src/config/validation.schema';

/**
 * TypeORM 1.x's rule in every database test (27 November 2026): a null or an
 * undefined in a where fails — never «any row», in a find and in a write.
 */
describe('a missing value in a where', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('fails in a find, instead of matching every row', async () => {
    const repo = h.app.get(DataSource).getRepository(Publisher);
    await expect(
      repo.findOne({ where: { id: undefined as unknown as string } }),
    ).rejects.toThrow(
      /Undefined value encountered in property '(Publisher\.)?id'/,
    );
    await expect(
      repo.findOne({ where: { id: null as unknown as string } }),
    ).rejects.toThrow(/Null value encountered in property '(Publisher\.)?id'/);
  });

  it('fails in an update and a delete, before anything is touched', async () => {
    const repo = h.app.get(DataSource).getRepository(Publisher);
    const [{ n: before }] = await h.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM publishers`,
    );
    const [{ congregation_id: tenant }] = await h.sql<{
      congregation_id: string;
    }>(`SELECT congregation_id FROM users LIMIT 1`);
    await expect(
      repo.delete({
        congregationId: tenant,
        id: undefined as unknown as string,
      }),
    ).rejects.toThrow(
      /Undefined value encountered in property '(Publisher\.)?id'/,
    );
    await expect(
      repo.update({ congregationId: tenant, id: null as unknown as string }, {
        notes: 'x',
      } as never),
    ).rejects.toThrow(/Null value encountered in property '(Publisher\.)?id'/);
    const [{ n: after }] = await h.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM publishers`,
    );
    expect(after).toBe(before);
  });

  it('TypeORM 1.x: the rule is always on — there is no «as 0.3» to switch back to', () => {
    expect(whereValuesMode()).toBe('throw');
    expect(invalidWhereValuesBehavior()).toEqual({
      null: 'throw',
      undefined: 'throw',
    });
  });

  it('an old .env still starts; a mistyped value still stops the start', () => {
    const check = (v: string) =>
      validationSchema.extract('WHERE_INVALID_VALUES').validate(v).error
        ?.message;
    expect(check('Throw')).toMatch(/must be one of/);
    expect(check('throw')).toBeUndefined();
    expect(check('off')).toBeUndefined();
  });
});
