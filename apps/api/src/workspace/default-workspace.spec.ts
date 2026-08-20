import { UserRole, WorkspaceRole } from '@prisma/client';
import {
  DEFAULT_WORKSPACE_ID,
  __resetDefaultWorkspaceCacheForTests,
  defaultWorkspaceRoleForUserRole,
  getDefaultWorkspaceId,
} from './default-workspace';

function makePrismaMock() {
  return {
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DEFAULT_WORKSPACE_ID }),
    },
  };
}

describe('default-workspace (EVT-39)', () => {
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
});
