import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { workspaceDbContext } from './workspace-context';
import { WorkspaceDbContextInterceptor } from './workspace-db-context.interceptor';

function makeContext(workspace: { id: string } | null | undefined) {
  const request = { workspace };
  return {
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
});
