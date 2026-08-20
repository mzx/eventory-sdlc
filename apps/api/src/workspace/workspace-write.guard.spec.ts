import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { WorkspaceWriteGuard } from './workspace-write.guard';

function makeContext(workspace: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ workspace }) }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceWriteGuard', () => {
  let guard: WorkspaceWriteGuard;

  beforeEach(() => {
    guard = new WorkspaceWriteGuard();
  });

  it('allows an owner through', () => {
    const context = makeContext({ id: 'ws-1', role: WorkspaceRole.owner });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a member through', () => {
    const context = makeContext({ id: 'ws-1', role: WorkspaceRole.member });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('AC5: throws ForbiddenException for a viewer', () => {
    const context = makeContext({ id: 'ws-1', role: WorkspaceRole.viewer });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('does not throw when workspace is null — @CurrentWorkspace() handles that 403 instead', () => {
    const context = makeContext(null);
    expect(guard.canActivate(context)).toBe(true);
  });
});
