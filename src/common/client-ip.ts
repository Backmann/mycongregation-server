/**
 * Who a request actually came from.
 *
 * The server does not face the internet: nginx stands in front of it, and
 * Cloudflare in front of that. Express, left alone, reports the address of the
 * socket — which is nginx, the same value for every person in the
 * congregation. Every limit keyed on it therefore counted the whole
 * congregation as one visitor: six sign-ins in a quarter of an hour and the
 * seventh person was turned away.
 *
 * Order of preference, and why:
 *
 *  1. `CF-Connecting-IP` — Cloudflare writes it and it holds exactly one
 *     address, so there is nothing to parse and nothing to choose. Honoured
 *     only when the request reached us through a proxy we trust.
 *  2. `X-Forwarded-For`, leftmost entry, via Express — for a deployment
 *     without Cloudflare in front.
 *  3. The socket address — direct traffic, or a proxy that says nothing.
 *
 * What this is NOT: proof of origin. Anyone who can reach the origin without
 * going through Cloudflare can write these headers themselves. That is why the
 * limits which actually protect an account are keyed on the ACCOUNT, and the
 * address is only used for the broad net underneath. See AuthService.
 */
import type { Request } from 'express';

/**
 * Addresses that can only be our own infrastructure: loopback, the Docker
 * bridge, and the private ranges. A hop from one of these is the reverse
 * proxy talking to us, so what it forwards may be believed.
 */
export function isTrustedHop(ip: string | undefined): boolean {
  if (!ip) return false;
  // ::ffff:172.18.0.5 — IPv4 written as IPv6, which is what Node hands back
  // on a dual-stack socket.
  const bare = ip.replace(/^::ffff:/, '');
  if (bare === '127.0.0.1' || bare === '::1') return true;
  if (bare.startsWith('10.') || bare.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return true;
  return false;
}

/** Strip the IPv6 wrapper and any port, so two spellings never make two keys. */
function tidy(ip: string): string {
  return ip.replace(/^::ffff:/, '').trim();
}

export function clientIp(req: Request): string {
  const socket = req.socket?.remoteAddress;

  if (isTrustedHop(socket)) {
    const cf = req.headers['cf-connecting-ip'];
    const value = Array.isArray(cf) ? cf[0] : cf;
    if (value && value.trim() !== '') return tidy(value);
  }

  // Populated by Express only when `trust proxy` is set — see main.ts.
  const forwarded = req.ips;
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return tidy(forwarded[0]);
  }

  // `req.ip` is Express's own answer, already resolved through whatever it has
  // been told to trust. It is asked before the raw socket because the two
  // differ exactly when the proxy is being read correctly.
  if (req.ip && req.ip.trim() !== '') return tidy(req.ip);

  return socket ? tidy(socket) : 'unknown';
}
