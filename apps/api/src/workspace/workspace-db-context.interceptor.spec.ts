import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of, Subject } from 'rxjs';
import { workspaceDbContext } from './workspace-context';
import { WorkspaceDbContextInterceptor } from './workspace-db-context.interceptor';

function makeContext(
  workspace: { id: string } | null | undefined,
  type: 'http' | 'rpc' | 'ws' = 'http',
) {
  const request = { workspace };
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceDbContextInterceptor', () => {
  let interceptor: WorkspaceDbContextInterceptor;

  beforeEach(() => {
    interceptor = new WorkspaceDbContextInterceptor();
  });

  it('enters workspaceDbContext with the resolved request.workspace.id before invoking the handler', (done) => {
    const context = makeContext({ id: 'ws-1' });
    let observedStore: unknown;
    const next: CallHandler = {
      handle: () => {
        observedStore = workspaceDbContext.getStore();
        return of('handler-result');
      },
    };

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toBe('handler-result');
      expect(observedStore).toEqual({ workspaceId: 'ws-1' });
      done();
    });
  });

  it('enters with workspaceId: undefined when request.workspace is null (@AllowPending()/@AllowMissingWorkspace() with no resolved membership)', (done) => {
    const context = makeContext(null);
    let observedStore: unknown;
    const next: CallHandler = {
      handle: () => {
        observedStore = workspaceDbContext.getStore();
        return of('ok');
      },
    };

    interceptor.intercept(context, next).subscribe(() => {
      expect(observedStore).toEqual({ workspaceId: undefined });
      done();
    });
  });

  it('enters with workspaceId: undefined when request.workspace was never set at all (@Public() routes)', (done) => {
    const context = makeContext(undefined);
    let observedStore: unknown;
    const next: CallHandler = {
      handle: () => {
        observedStore = workspaceDbContext.getStore();
        return of('ok');
      },
    };

    interceptor.intercept(context, next).subscribe(() => {
      expect(observedStore).toEqual({ workspaceId: undefined });
      done();
    });
  });

  it('never leaks context between two back-to-back requests for DIFFERENT workspaces', (done) => {
    const observed: unknown[] = [];
    const makeNext = (): CallHandler => ({
      handle: () => {
        observed.push(workspaceDbContext.getStore());
        return of('ok');
      },
    });

    interceptor.intercept(makeContext({ id: 'ws-a' }), makeNext()).subscribe(() => {
      interceptor.intercept(makeContext({ id: 'ws-b' }), makeNext()).subscribe(() => {
        expect(observed).toEqual([{ workspaceId: 'ws-a' }, { workspaceId: 'ws-b' }]);
        done();
      });
    });
  });

  // ---------------------------------------------------------------------
  // Round-2 review, finding 10
  // ---------------------------------------------------------------------

  it('passes non-HTTP execution contexts straight through, without touching workspaceDbContext or calling switchToHttp', (done) => {
    const context = makeContext(undefined, 'rpc');
    // No `workspace` property, and `switchToHttp` would throw if called —
    // proves the getType() guard short-circuits before either is touched.
    (context as unknown as { switchToHttp: unknown }).switchToHttp = () => {
      throw new Error('switchToHttp should not be called for a non-HTTP context');
    };
    let observedStore: unknown = 'not-set';
    const next: CallHandler = {
      handle: () => {
        observedStore = workspaceDbContext.getStore();
        return of('rpc-result');
      },
    };

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toBe('rpc-result');
      // workspaceDbContext.run() was never called, so no store is entered —
      // getStore() returns whatever the ambient (outer, test-level) context
      // is, i.e. undefined here.
      expect(observedStore).toBeUndefined();
      done();
    });
  });

  it('unsubscribing from the returned Observable tears down the inner next.handle() subscription', () => {
    const context = makeContext({ id: 'ws-1' });
    const inner = new Subject<string>();
    let innerUnsubscribed = false;
    const next: CallHandler = {
      handle: () =>
        new Observable<string>((subscriber) => {
          const sub = inner.subscribe(subscriber);
          return () => {
            innerUnsubscribed = true;
            sub.unsubscribe();
          };
        }),
    };

    const outerSubscription = interceptor.intercept(context, next).subscribe();
    expect(innerUnsubscribed).toBe(false);

    outerSubscription.unsubscribe();

    expect(innerUnsubscribed).toBe(true);
  });
});
