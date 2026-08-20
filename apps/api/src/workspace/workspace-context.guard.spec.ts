import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus, WorkspaceRole } from '@prisma/client';
import { WorkspaceContextGuard } from './workspace-context.guard';
import { WORKSPACE_HEADER, WORKSPACE_QUERY_PARAM } from './workspace-context';

const WORKSPACE_A = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

function makePrismaMock() {
  return {
    workspaceMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

function makeContext(opts: {
  user?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  isPublic?: boolean;
  allowPending?: boolean;
  allowMissingWorkspace?: boolean;
}) {
  const request: Record<string, unknown> = {
    user: opts.user,
    headers: opts.headers ?? {},
    query: opts.query ?? {},
  };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'eventory:isPublic') return opts.isPublic ?? false;
      if (key === 'eventory:allowPending') return opts.allowPending ?? false;
      if (key === 'eventory:allowMissingWorkspace') return opts.allowMissingWorkspace ?? false;
      return false;
    }),
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request, reflector };
}

describe('WorkspaceContextGuard', () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let guard: WorkspaceContextGuard;

  beforeEach(() => {
    prismaMock = makePrismaMock();
  });

  it('skips resolution entirely for a @Public() route', async () => {
    const { context, request, reflector } = makeContext({ isPublic: true });
    guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.workspace).toBeUndefined();
    expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('sets workspace to null when no user is attached (@AllowPending, signed out)', async () => {
    const { context, request, reflector } = makeContext({ user: undefined, allowPending: true });
    guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.workspace).toBeNull();
  });

  it('sets workspace to null for an @AllowPending() route when the user is not yet approved', async () => {
    const { context, request, reflector } = makeContext({
      user: { id: USER_ID, status: UserStatus.pending },
      allowPending: true,
    });
    guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.workspace).toBeNull();
    expect(prismaMock.workspaceMember.findFirst).not.toHaveBeenCalled();
  });

  describe('no X-Workspace-Id header — default resolution', () => {
    it("resolves the caller's oldest membership as the default workspace", async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findFirst.mockResolvedValue({
        workspaceId: WORKSPACE_A,
        role: WorkspaceRole.member,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toEqual({ id: WORKSPACE_A, role: WorkspaceRole.member });
      expect(prismaMock.workspaceMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID }, orderBy: { createdAt: 'asc' } }),
      );
    });

    it('EVT-42 round-2 (CRITICAL, fail-closed): throws ForbiddenException when the caller has zero memberships, on a route with NO opt-out', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findFirst.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(request.workspace).toBeNull();
    });

    it('@AllowMissingWorkspace(): resolves true (no throw) for a zero-membership caller on an opted-out route', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        allowMissingWorkspace: true,
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findFirst.mockResolvedValue(null);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toBeNull();
    });

    it('@AllowPending(): resolves true (no throw) for an APPROVED zero-membership caller — GET /auth/me must always resolve', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        allowPending: true,
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findFirst.mockResolvedValue(null);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toBeNull();
    });
  });

  describe('X-Workspace-Id header present', () => {
    it('resolves the requested workspace when the caller is a member', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: WORKSPACE_B },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: WORKSPACE_B,
        role: WorkspaceRole.owner,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toEqual({ id: WORKSPACE_B, role: WorkspaceRole.owner });
      expect(prismaMock.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId_userId: { workspaceId: WORKSPACE_B, userId: USER_ID } },
        }),
      );
    });

    it('AC1: throws ForbiddenException (403) for a workspace the caller is not a member of', async () => {
      const { context, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: WORKSPACE_B },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for a malformed (non-UUID) header without querying the DB', async () => {
      const { context, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: 'not-a-uuid' },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    // EVT-40 round-2 review, security suggestion 7 — never reflect
    // caller-supplied input (the raw header value) back into an error message.
    it('the 403 message never echoes the caller-supplied header value back', async () => {
      const suspiciousHeader = '<script>alert(1)</script>-not-a-uuid';
      const { context, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: suspiciousHeader },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Not a member of the requested workspace',
      );
    });

    it('uses the first value when the header is sent multiple times', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: [WORKSPACE_A, WORKSPACE_B] },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: WORKSPACE_A,
        role: WorkspaceRole.member,
      });

      await guard.canActivate(context);
      expect(request.workspace).toEqual({ id: WORKSPACE_A, role: WorkspaceRole.member });
    });
  });

  // Photo-serving hotfix: `<img src="/storage/…">` sends the session cookie
  // but can never attach `X-Workspace-Id`, so the guard accepts the same
  // selection as `?workspace=` — without it, every photo rendered while a
  // non-default workspace is active resolved under the caller's OLDEST
  // workspace and 404'd (broken images on item cards/detail/print).
  describe('?workspace= query parameter (image subresource path)', () => {
    it('resolves the requested workspace when the caller is a member (no header)', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        query: { [WORKSPACE_QUERY_PARAM]: WORKSPACE_B },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: WORKSPACE_B,
        role: WorkspaceRole.viewer,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toEqual({ id: WORKSPACE_B, role: WorkspaceRole.viewer });
      expect(prismaMock.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId_userId: { workspaceId: WORKSPACE_B, userId: USER_ID } },
        }),
      );
    });

    it('throws ForbiddenException (403) for a query workspace the caller is not a member of — same as the header', async () => {
      const { context, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        query: { [WORKSPACE_QUERY_PARAM]: WORKSPACE_B },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for a malformed (non-UUID) query value without querying the DB', async () => {
      const { context, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        query: { [WORKSPACE_QUERY_PARAM]: 'not-a-uuid' },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('the header wins when both header and query are present', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        headers: { [WORKSPACE_HEADER]: WORKSPACE_A },
        query: { [WORKSPACE_QUERY_PARAM]: WORKSPACE_B },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        workspaceId: WORKSPACE_A,
        role: WorkspaceRole.member,
      });

      await guard.canActivate(context);
      expect(request.workspace).toEqual({ id: WORKSPACE_A, role: WorkspaceRole.member });
      expect(prismaMock.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId_userId: { workspaceId: WORKSPACE_A, userId: USER_ID } },
        }),
      );
    });

    it('treats a non-string query value (bracketed/object parse) as absent — falls back to the default membership', async () => {
      const { context, request, reflector } = makeContext({
        user: { id: USER_ID, status: UserStatus.approved },
        query: { [WORKSPACE_QUERY_PARAM]: { nested: WORKSPACE_B } },
      });
      guard = new WorkspaceContextGuard(reflector as unknown as Reflector, prismaMock as never);
      prismaMock.workspaceMember.findFirst.mockResolvedValue({
        workspaceId: WORKSPACE_A,
        role: WorkspaceRole.owner,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.workspace).toEqual({ id: WORKSPACE_A, role: WorkspaceRole.owner });
      expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled();
    });
  });
});
