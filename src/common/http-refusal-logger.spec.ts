import { httpRefusalLogger } from './http-refusal-logger';

/**
 * The point of these is the second half: what must NOT reach the log.
 */
describe('httpRefusalLogger', () => {
  const run = (
    status: number,
    req: Record<string, unknown> = {},
  ): { warn: string[]; error: string[] } => {
    const warn: string[] = [];
    const error: string[] = [];
    jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@nestjs/common').Logger.prototype,
        'warn',
      )
      .mockImplementation((...args: unknown[]) => warn.push(String(args[0])));
    jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@nestjs/common').Logger.prototype,
        'error',
      )
      .mockImplementation((...args: unknown[]) => error.push(String(args[0])));

    const handlers: Record<string, () => void> = {};
    const res = {
      statusCode: status,
      on: (event: string, cb: () => void) => {
        handlers[event] = cb;
      },
    };
    const next = jest.fn();
    httpRefusalLogger()(
      { method: 'GET', path: '/api/auth/me', ...req } as never,
      res as never,
      next as never,
    );
    expect(next).toHaveBeenCalled();
    handlers.finish?.();
    return { warn, error };
  };

  afterEach(() => jest.restoreAllMocks());

  it('says nothing about a request that succeeded', () => {
    const { warn, error } = run(200);

    expect(warn).toEqual([]);
    expect(error).toEqual([]);
  });

  it('writes a refusal with its path and who asked', () => {
    const { warn } = run(401, { user: { id: 'user-7' } });

    expect(warn[0]).toBe('401 GET /api/auth/me · user-7');
  });

  it('calls a nameless caller anonymous rather than leaving a gap', () => {
    const { warn } = run(403);

    expect(warn[0]).toContain('anonymous');
  });

  it('treats the server\u2019s own failures as errors, not warnings', () => {
    const { warn, error } = run(500);

    expect(error).toHaveLength(1);
    expect(warn).toEqual([]);
  });

  it('never writes the body, the query or the headers', () => {
    // They carry names, notes, contacts and tokens. The path and the status
    // are enough to find the thing; personal changes belong in the journal.
    const { warn } = run(400, {
      body: { password: 'секрет', notes: 'личное' },
      query: { email: 'brother@example.org' },
      headers: { authorization: 'Bearer abc.def.ghi' },
    });

    expect(warn[0]).not.toContain('секрет');
    expect(warn[0]).not.toContain('личное');
    expect(warn[0]).not.toContain('brother@example.org');
    expect(warn[0]).not.toContain('Bearer');
  });
});
