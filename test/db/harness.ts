import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { dbEnv } from './env';

/**
 * The real application over HTTP, as the phone and the web talk to it.
 *
 * Unit tests hand every service a stub, and the stubs are where today's bugs
 * hid: a test of «undo» fed a field the real code never writes; a test of the
 * journal used an entry without a card although every real entry has one.
 * Here nothing is stubbed: the modules, the guards, the validation, the
 * transactions and the database are the production ones.
 */
export interface Harness {
  app: INestApplication;
  db: DataSource;
  /** An HTTP call as `who` (a login name), or anonymously with null. */
  as(who: string | null): {
    get(path: string): request.Test;
    post(path: string, body?: object): request.Test;
    patch(path: string, body?: object): request.Test;
    delete(path: string): request.Test;
  };
  sql<T = Record<string, unknown>>(q: string, params?: unknown[]): Promise<T[]>;
  /** A sign-in with this role and password, optionally linked to a card. */
  addUser(opts: {
    login: string;
    role: 'admin' | 'elder' | 'ministerial_servant' | 'publisher';
    publisherId?: string;
  }): Promise<string>;
  addPublisher(body: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export const PASSWORD = 'Db-Test-Pass-9xQ!';

let counter = 0;

export async function startHarness(): Promise<Harness> {
  const env = dbEnv();
  Object.assign(process.env, env);
  // A fresh copy of the migrated template for this file: its own data, and
  // the reference rows the migrations seed (catalogue, songs) already there.
  const own = `${env.POSTGRES_DB}_${process.pid}_${++counter}`;
  const admin = new Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_ADMIN_DB,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${own}" TEMPLATE "${env.POSTGRES_DB}"`);
  await admin.end();
  process.env.POSTGRES_DB = own;
  // Imported only now: the configuration reads the environment on import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../src/app.module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    SentFieldsOnlyValidationPipe,
  } = require('../../src/common/pipes/sent-fields-only-validation.pipe');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validationRefusal } = require('../../src/common/errors/refusal');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new SentFieldsOnlyValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationRefusal,
    }),
  );
  await app.init();
  const db = app.get(DataSource);
  const server = app.getHttpServer();
  const tokens = new Map<string, string>();

  // One congregation per test file: the bootstrap works only on an empty
  // database, so later files make theirs through SQL beside the first.
  const users = await db.query(`SELECT count(*)::int AS n FROM users`);
  const adminLogin = 'dbtest-admin';
  if (users[0].n === 0) {
    await request(server)
      .post('/api/auth/bootstrap')
      .send({
        congregationName: 'DB-Test',
        country: 'DE',
        language: 'ru',
        timezone: 'Europe/Berlin',
        email: `${adminLogin}@example.invalid`,
        password: PASSWORD,
      })
      .expect(201);
    await db.query(`UPDATE users SET login_name = $1 WHERE email = $2`, [
      adminLogin,
      `${adminLogin}@example.invalid`,
    ]);
  } else {
    throw new Error('test/db: the template database is not empty');
  }

  const token = async (who: string): Promise<string> => {
    const known = tokens.get(who);
    if (known) return known;
    const res = await request(server)
      .post('/api/auth/login')
      .send({ login: who, password: PASSWORD });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(
        `login ${who}: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    tokens.set(who, res.body.accessToken);
    return res.body.accessToken;
  };

  const as: Harness['as'] = (who) => {
    const login = who === 'admin' ? adminLogin : who;
    // Returns nothing on purpose: a supertest request is itself thenable, and
    // resolving a promise WITH it would call its (wrapped) then again forever.
    const auth = async (t: request.Test): Promise<void> => {
      if (login) t.set('Authorization', `Bearer ${await token(login)}`);
    };
    const wrap = (t: request.Test): request.Test => {
      // supertest is thenable; set the header lazily before it runs.
      const then = t.then.bind(t);
      (t as unknown as { then: unknown }).then = (ok: unknown, bad: unknown) =>
        auth(t).then(() =>
          then(
            ok as (v: request.Response) => unknown,
            bad as (e: unknown) => unknown,
          ),
        );
      return t;
    };
    return {
      get: (p) => wrap(request(server).get(`/api${p}`)),
      post: (p, b) =>
        wrap(
          request(server)
            .post(`/api${p}`)
            .send(b ?? {}),
        ),
      patch: (p, b) =>
        wrap(
          request(server)
            .patch(`/api${p}`)
            .send(b ?? {}),
        ),
      delete: (p) => wrap(request(server).delete(`/api${p}`)),
    };
  };

  const harness: Harness = {
    app,
    db,
    as,
    sql: (q, params) => db.query(q, params),
    async addPublisher(body) {
      const res = await as('admin').post('/publishers', {
        gender: 'brother',
        ...body,
      });
      if (res.status !== 201) {
        throw new Error(
          `addPublisher: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      return res.body.id;
    },
    async addUser({ login, role, publisherId }) {
      const res = await as('admin').post('/users', {
        loginName: login,
        password: PASSWORD,
        role,
      });
      if (res.status !== 201) {
        throw new Error(`addUser: ${res.status} ${JSON.stringify(res.body)}`);
      }
      const id: string = res.body.id ?? res.body.user?.id;
      if (publisherId) {
        const link = await as('admin').patch(`/users/${id}/publisher`, {
          publisherId,
        });
        if (link.status !== 200) {
          throw new Error(`link: ${link.status} ${JSON.stringify(link.body)}`);
        }
      }
      tokens.delete(login);
      return id;
    },
    async close() {
      await app.close();
      const a = new Client({
        host: env.POSTGRES_HOST,
        port: Number(env.POSTGRES_PORT),
        user: env.POSTGRES_USER,
        password: env.POSTGRES_PASSWORD,
        database: env.POSTGRES_ADMIN_DB,
      });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS "${own}" WITH (FORCE)`);
      await a.end();
    },
  };
  return harness;
}
