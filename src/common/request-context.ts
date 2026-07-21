import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId: string;
  congregationId: string;
}

/**
 * Who is acting, available anywhere without being passed as an argument.
 *
 * The journal needs an actor for every change, but the services that change
 * things were never given one: create/update/remove take a congregation id and
 * nothing else. Threading a user parameter through them would mean touching
 * every signature, every controller and every internal caller — and the moment
 * one call is missed the entry is written with the wrong author, or none, and
 * nothing complains. A journal that is quietly wrong is worse than none.
 *
 * So the request carries the actor alongside itself. An interceptor puts it in
 * here when a request arrives, and the audit service reads it when it writes.
 * Node's AsyncLocalStorage keeps it attached across awaits within that request
 * and nowhere else, so two people acting at the same moment never see each
 * other's context.
 *
 * Outside a request — the nightly jobs, imports run on a schedule — there is
 * no context, and that absence is meaningful: the change was made by the
 * system, and the entry says so rather than blaming whoever happened to be
 * signed in.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** The acting user, or undefined when nothing human is acting. */
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};
