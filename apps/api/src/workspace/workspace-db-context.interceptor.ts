import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
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
 */
@Injectable()
export class WorkspaceDbContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const workspaceId = request.workspace?.id;

    return new Observable((subscriber) => {
      workspaceDbContext.run({ workspaceId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
