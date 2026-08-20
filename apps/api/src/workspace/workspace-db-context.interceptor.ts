import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { RequestWithWorkspace, workspaceDbContext } from './workspace-context';

/**
 * Global interceptor (registered as `APP_INTERCEPTOR` in `AppModule`) — the
 * EVT-44 write side of `workspaceDbContext`. Every guard (`JwtAuthGuard`,
 * `WorkspaceContextGuard`) has already run by the time any interceptor
 * fires, so `request.workspace` is fully resolved here.
 *
 * Wraps the rest of the request — the controller handler and everything it
 * awaits, all the way down into `PrismaService` — in
 * `workspaceDbContext.run({ workspaceId }, () => next.handle())`.
 * `AsyncLocalStorage.run()` (NOT `.enterWith()`) is what makes this safe
 * under concurrent requests: `.run()` establishes a genuinely NEW, isolated
 * async context for everything invoked synchronously within its callback
 * (`next.handle()` here — Nest's Observable is lazy, so calling it inside
 * the callback is what matters, not merely constructing it) and everything
 * that continuation later awaits, with no risk of a DIFFERENT request's
 * context leaking in or being clobbered.
 *
 * This task's FIRST implementation instead called
 * `workspaceDbContext.enterWith(...)` directly inside
 * `WorkspaceContextGuard.canActivate` (a simpler-looking one-liner at each of
 * that guard's `request.workspace = ...` assignments) — and an early e2e
 * run of two CONCURRENT tenant-scoped requests (`Promise.all` against two
 * different workspaces) surfaced real, intermittent
 * `new row violates row-level security policy` errors on requests that were
 * scoping their OWN data correctly. `enterWith()` mutates whatever async
 * context is active at the moment it's called rather than creating a new
 * boundary; since `canActivate()` is `async` and resumes after a real `await`
 * (the membership lookup), it does not run inside a context that's cleanly
 * isolated per-request, so one request's `enterWith()` could stomp another
 * in-flight request's context. Moving the SAME assignment into this
 * interceptor's `.run()` wrapper — a textbook request-scoped-context pattern
 * — closed the race; see `test/rls-isolation.e2e-spec.ts`'s AC3
 * interleaved-request test, which reproduces the exact concurrency shape
 * that caught this.
 *
 * Round-2 review, SHOULD FIX finding 10 (two independent fixes):
 * 1. `context.getType() === 'http'` guard — this interceptor is registered
 *    globally (`APP_INTERCEPTOR`), so it runs for every execution context
 *    Nest supports, not just HTTP. `switchToHttp().getRequest()` on a
 *    non-HTTP context (this app has none today, but a future WebSocket
 *    gateway or microservice handler would) returns an object with no
 *    `workspace` property, silently proceeding with `workspaceId: undefined`
 *    rather than failing loudly — cheap to guard explicitly now rather than
 *    rely on every future context type happening to degrade safely.
 * 2. The inner `next.handle().subscribe(subscriber)` `Subscription` is now
 *    returned from the `Observable` constructor's callback as its teardown
 *    function, so an upstream unsubscribe (e.g. a client that disconnects
 *    mid-request) actually propagates down into `next.handle()`'s own
 *    subscription instead of leaking it.
 */
@Injectable()
export class WorkspaceDbContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const workspaceId = request.workspace?.id;

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      workspaceDbContext.run({ workspaceId }, () => {
        subscription = next.handle().subscribe(subscriber);
      });
      return () => subscription?.unsubscribe();
    });
  }
}
