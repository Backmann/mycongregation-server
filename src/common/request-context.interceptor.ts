import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { requestContext } from './request-context';

/**
 * Puts the signed-in user into the request context for the life of the
 * request, so anything downstream — the journal in particular — can name the
 * actor without being handed it.
 *
 * Registered globally and after authentication, so `request.user` is already
 * populated. On public routes there is no user and no context is opened: an
 * anonymous request must not be recorded as if somebody made it.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; congregationId?: string };
    }>();

    const userId = request?.user?.id;
    const congregationId = request?.user?.congregationId;
    if (!userId || !congregationId) return next.handle();

    return requestContext.run({ userId, congregationId }, () => next.handle());
  }
}
