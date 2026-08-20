import { UserRole, WorkspaceRole } from '@prisma/client';
import {
  DEFAULT_WORKSPACE_ID,
  __resetDefaultWorkspaceCacheForTests,
  defaultWorkspaceRoleForUserRole,
  ensureDefaultWorkspaceMembership,
  getDefaultWorkspaceId,
} from './default-workspace';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makePrismaMock() {
  return {
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DEFAULT_WORKSPACE_ID }),
    },
    workspaceMember: {
      upsert: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('default-workspace (EVT-39 / EVT-40)', () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    __resetDefaultWorkspaceCacheForTests();
    prismaMock = makePrismaMock();
  });

  describe('getDefaultWorkspaceId', () => {
    it('resolves the default workspace id via a single DB lookup', async () => {
      const id = await getDefaultWorkspaceId(prismaMock as never);

      expect(id).toBe(DEFAULT_WORKSPACE_ID);
      expect(prismaMock.workspace.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: DEFAULT_WORKSPACE_ID },
        select: { id: true },
      });
    });

    it('caches the result — a second call does not hit the DB again', async () => {
      await getDefaultWorkspaceId(prismaMock as never);
      await getDefaultWorkspaceId(prismaMock as never);

      expect(prismaMock.workspace.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    });

    it('propagates a lookup failure (e.g. migration not yet run) without caching it', async () => {
      prismaMock.workspace.findUniqueOrThrow.mockRejectedValueOnce(new Error('not found'));

      await expect(getDefaultWorkspaceId(prismaMock as never)).rejects.toThrow('not found');

      // Cache stayed empty after the failure, so a retry re-queries rather
      // than permanently caching a failed lookup.
      prismaMock.workspace.findUniqueOrThrow.mockResolvedValueOnce({ id: DEFAULT_WORKSPACE_ID });
      const id = await getDefaultWorkspaceId(prismaMock as never);
      expect(id).toBe(DEFAULT_WORKSPACE_ID);
      expect(prismaMock.workspace.findUniqueOrThrow).toHaveBeenCalledTimes(2);
    });
  });

  describe('defaultWorkspaceRoleForUserRole (EVT-40)', () => {
    it('maps admin -> owner', () => {
      expect(defaultWorkspaceRoleForUserRole(UserRole.admin)).toBe(WorkspaceRole.owner);
    });

    it('maps a plain user -> member', () => {
      expect(defaultWorkspaceRoleForUserRole(UserRole.user)).toBe(WorkspaceRole.member);
    });
  });

  describe('ensureDefaultWorkspaceMembership (EVT-40)', () => {
    it('upserts a WorkspaceMember row scoped to the Default Workspace and the given role when the user has zero memberships', async () => {
      prismaMock.workspaceMember.count.mockResolvedValueOnce(0);

      await ensureDefaultWorkspaceMembership(prismaMock as never, USER_ID, WorkspaceRole.owner);

      expect(prismaMock.workspaceMember.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
      expect(prismaMock.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: DEFAULT_WORKSPACE_ID, userId: USER_ID } },
        update: {},
        create: { workspaceId: DEFAULT_WORKSPACE_ID, userId: USER_ID, role: WorkspaceRole.owner },
      });
    });

    it('is idempotent — the upsert shape leaves an existing membership untouched (empty update)', async () => {
      prismaMock.workspaceMember.count.mockResolvedValueOnce(0);

      await ensureDefaultWorkspaceMembership(prismaMock as never, USER_ID, WorkspaceRole.member);

      const call = prismaMock.workspaceMember.upsert.mock.calls[0][0];
      expect(call.update).toEqual({});
    });

    // ── EVT-40 round-3 review, security finding ──────────────────────────
    //
    // Without this gate, a user whose Default Workspace membership was
    // deliberately revoked (EVT-42) would have it silently re-granted on
    // their very next login, turning "revoke" into a no-op.

    it('does NOT grant a Default Workspace membership when the user already has a membership in ANY workspace', async () => {
      prismaMock.workspaceMember.count.mockResolvedValueOnce(1);

      await ensureDefaultWorkspaceMembership(prismaMock as never, USER_ID, WorkspaceRole.member);

      expect(prismaMock.workspaceMember.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
      expect(prismaMock.workspaceMember.upsert).not.toHaveBeenCalled();
      // Doesn't even bother resolving the Default Workspace id when skipping.
      expect(prismaMock.workspace.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('still heals a user with zero memberships anywhere (EVT-20 lockout-recovery path)', async () => {
      prismaMock.workspaceMember.count.mockResolvedValueOnce(0);

      await ensureDefaultWorkspaceMembership(prismaMock as never, USER_ID, WorkspaceRole.owner);

      expect(prismaMock.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: DEFAULT_WORKSPACE_ID, userId: USER_ID } },
        update: {},
        create: { workspaceId: DEFAULT_WORKSPACE_ID, userId: USER_ID, role: WorkspaceRole.owner },
      });
    });

    it('role mapping for the healed (zero-membership) case is unchanged — admin -> owner', async () => {
      prismaMock.workspaceMember.count.mockResolvedValueOnce(0);

      await ensureDefaultWorkspaceMembership(
        prismaMock as never,
        USER_ID,
        defaultWorkspaceRoleForUserRole(UserRole.admin),
      );

      expect(prismaMock.workspaceMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ role: WorkspaceRole.owner }),
        }),
      );
    });
  });
});
