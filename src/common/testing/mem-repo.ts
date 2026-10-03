import { FindOperator } from 'typeorm';

/**
 * A table in memory that answers the way a repository does.
 *
 * For tests that run SEVERAL real services against each other — where a stub
 * returning a canned list would let each service be right on its own and the
 * chain between them wrong. It understands just enough of TypeORM to be asked
 * real questions: equality, In, IsNull, Not, Or, LessThan(OrEqual), Between, an OR of
 * several `where`s, soft deletion, unique keys, upsert, and the two plain
 * UPDATE statements the schedule issues through a query builder.
 *
 * Deliberately small. If a service starts asking something this cannot
 * answer, it throws rather than quietly returning everything.
 */

type Row = Record<string, any>;

function matches(value: any, cond: any): boolean {
  if (cond instanceof FindOperator) {
    const v = cond.value;
    switch (cond.type) {
      case 'in':
        return (v as any[]).includes(value);
      case 'isNull':
        return value === null || value === undefined;
      case 'not':
        return !matches(value, v);
      case 'or':
        return (v as any[]).some((c) => matches(value, c));
      case 'lessThanOrEqual':
        return value !== null && value !== undefined && value <= v;
      case 'moreThanOrEqual':
        return value !== null && value !== undefined && value >= v;
      case 'lessThan':
        return value !== null && value !== undefined && value < v;
      case 'between': {
        const [from, to] = v as any[];
        return value >= from && value <= to;
      }
      default:
        throw new Error(`memRepo: operator ${cond.type} is not supported`);
    }
  }
  if (cond === null) return value === null || value === undefined;
  return value === cond;
}

function rowMatches(row: Row, where: any): boolean {
  if (!where) return true;
  if (Array.isArray(where)) return where.some((w) => rowMatches(row, w));
  return Object.entries(where).every(([k, cond]) =>
    cond === undefined ? true : matches(row[k], cond),
  );
}

export interface MemRepo<T extends Row> {
  rows: T[];
  find: (q?: any) => Promise<T[]>;
  findOne: (q?: any) => Promise<T | null>;
  create: (x: Partial<T>) => T;
  insert: (x: Partial<T>) => Promise<void>;
  save: (x: any) => Promise<any>;
  update: (where: any, patch: Partial<T>) => Promise<void>;
  delete: (where: any) => Promise<void>;
  upsert: (
    rows: Partial<T>[],
    opts: { conflictPaths: string[] },
  ) => Promise<void>;
  createQueryBuilder: () => any;
  manager: { find: (entity: any, q?: any) => Promise<any[]> };
}

export function memRepo<T extends Row>(
  initial: T[] = [],
  opts: {
    /** Columns that together must be unique (ignored when any is null). */
    unique?: string[];
    /** What `repo.manager.find(Entity, …)` answers from. */
    manager?: MemRepo<any>;
  } = {},
): MemRepo<T> {
  const rows: T[] = initial;
  let seq = 0;
  const visible = (q?: any) =>
    rows.filter(
      (r) => (q?.withDeleted || !r.deletedAt) && rowMatches(r, q?.where),
    );
  const sorted = (list: T[], order?: Record<string, 'ASC' | 'DESC'>) => {
    if (!order) return list;
    const keys = Object.entries(order);
    return [...list].sort((a, b) => {
      for (const [k, dir] of keys) {
        if (a[k] === b[k]) continue;
        const less = a[k] < b[k] ? -1 : 1;
        return dir === 'DESC' ? -less : less;
      }
      return 0;
    });
  };

  const repo: MemRepo<T> = {
    rows,
    find: async (q) => sorted(visible(q), q?.order),
    findOne: async (q) => sorted(visible(q), q?.order)[0] ?? null,
    create: (x) => ({ id: `mem-${(seq += 1)}`, ...x }) as unknown as T,
    insert: async (x) => {
      const row = {
        id: `mem-${(seq += 1)}`,
        createdAt: new Date(),
        ...x,
      } as Row;
      const u = opts.unique;
      if (u && u.every((k) => row[k] !== null && row[k] !== undefined)) {
        if (rows.some((r) => u.every((k) => r[k] === row[k]))) {
          // What Postgres says, and the only thing a caller may read as
          // «already there».
          throw Object.assign(new Error('duplicate key value'), {
            code: '23505',
          });
        }
      }
      rows.push(row as T);
      // TypeORM writes the generated id back onto what it was given.
      Object.assign(x, { id: row.id });
    },
    save: async (x) => {
      const list = Array.isArray(x) ? x : [x];
      for (const item of list) {
        const at = rows.findIndex((r) => r.id === item.id);
        if (at >= 0) Object.assign(rows[at], item);
        else rows.push({ id: `mem-${(seq += 1)}`, ...item });
      }
      return x;
    },
    update: async (where, patch) => {
      for (const r of rows) if (rowMatches(r, where)) Object.assign(r, patch);
    },
    delete: async (where) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rowMatches(rows[i], where)) rows.splice(i, 1);
      }
    },
    upsert: async (list, { conflictPaths }) => {
      for (const item of list as Row[]) {
        const at = rows.findIndex((r) =>
          conflictPaths.every((k) => r[k] === item[k]),
        );
        if (at >= 0) Object.assign(rows[at], item);
        else rows.push({ id: `mem-${(seq += 1)}`, ...item } as unknown as T);
      }
    },
    /**
     * `UPDATE … SET … WHERE a = :a AND … AND <literal>` — the shape of the two
     * statements the schedule issues. Named parameters are compared for
     * equality; the three literals it uses are understood by name.
     */
    createQueryBuilder: () => {
      let patch: Row = {};
      const params: Row = {};
      const literals: string[] = [];
      const take = (sql: string, p?: Row) => {
        if (p) Object.assign(params, p);
        else literals.push(sql);
        return qb;
      };
      const qb: any = {
        update: () => qb,
        set: (p: Row) => {
          patch = p;
          return qb;
        },
        where: take,
        andWhere: take,
        execute: async () => {
          let affected = 0;
          for (const r of rows) {
            if (!Object.entries(params).every(([k, v]) => r[k] === v)) continue;
            const ok = literals.every((l) => {
              if (l === "status = 'draft'") return r.status === 'draft';
              if (l === 'deletedAt IS NULL') return !r.deletedAt;
              if (l === 'changedSincePublish = true') {
                return r.changedSincePublish === true;
              }
              throw new Error(`memRepo: cannot read the condition «${l}»`);
            });
            if (!ok) continue;
            Object.assign(r, patch);
            affected += 1;
          }
          return { affected };
        },
      };
      return qb;
    },
    manager: {
      find: async (_entity, q) => (opts.manager ? opts.manager.find(q) : []),
    },
  };
  return repo;
}
