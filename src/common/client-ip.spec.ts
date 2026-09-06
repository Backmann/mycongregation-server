import type { Request } from 'express';
import { clientIp, isTrustedHop } from './client-ip';

/**
 * A request as Express hands it over: the socket it arrived on, whatever
 * headers came with it, and `ips` — which Express fills in ONLY when it has
 * been told to trust a proxy. The distinction is the whole subject here.
 */
function req(opts: {
  socket?: string;
  cf?: string;
  ips?: string[];
  ip?: string;
}): Request {
  return {
    socket: { remoteAddress: opts.socket },
    headers: opts.cf ? { 'cf-connecting-ip': opts.cf } : {},
    ips: opts.ips ?? [],
    ip: opts.ip,
  } as unknown as Request;
}

describe('isTrustedHop', () => {
  it('knows our own infrastructure', () => {
    expect(isTrustedHop('127.0.0.1')).toBe(true);
    expect(isTrustedHop('::1')).toBe(true);
    expect(isTrustedHop('172.18.0.5')).toBe(true);
    expect(isTrustedHop('::ffff:172.18.0.5')).toBe(true);
    expect(isTrustedHop('10.0.0.9')).toBe(true);
    expect(isTrustedHop('192.168.1.4')).toBe(true);
  });

  it('does not trust the public internet', () => {
    expect(isTrustedHop('93.184.216.34')).toBe(false);
    // 172.32 is OUTSIDE the private range, which ends at 172.31. A prefix
    // match on «172.» would have trusted it.
    expect(isTrustedHop('172.32.0.1')).toBe(false);
    expect(isTrustedHop('172.15.0.1')).toBe(false);
    expect(isTrustedHop(undefined)).toBe(false);
  });
});

describe('clientIp', () => {
  it('reads the address Cloudflare states, when our own proxy forwarded it', () => {
    expect(clientIp(req({ socket: '172.18.0.5', cf: '203.0.113.7' }))).toBe(
      '203.0.113.7',
    );
  });

  it('ignores that header from a caller talking to us directly', () => {
    // Otherwise anybody could name themselves and the limits would count a
    // different person on every request.
    expect(clientIp(req({ socket: '203.0.113.9', cf: '198.51.100.1' }))).toBe(
      '203.0.113.9',
    );
  });

  it('falls back to the forwarded chain when there is no Cloudflare', () => {
    expect(
      clientIp(
        req({ socket: '172.18.0.5', ips: ['198.51.100.4', '10.0.0.2'] }),
      ),
    ).toBe('198.51.100.4');
  });

  it('falls back to the socket when nothing was forwarded', () => {
    expect(clientIp(req({ socket: '::ffff:198.51.100.9' }))).toBe(
      '198.51.100.9',
    );
  });

  it('never returns the proxy itself when the caller is knowable', () => {
    // The defect this file exists for: every person in the congregation
    // arriving as the same 172.x, so one limit counted them all as one.
    const a = clientIp(req({ socket: '172.18.0.5', cf: '203.0.113.7' }));
    const b = clientIp(req({ socket: '172.18.0.5', cf: '203.0.113.8' }));
    expect(a).not.toBe(b);
  });

  it('takes Express\u2019s own answer when it has one', () => {
    // With `trust proxy` set, this is already the caller rather than the hop.
    expect(clientIp(req({ ip: '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('says «unknown» rather than nothing when there is no socket at all', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});
