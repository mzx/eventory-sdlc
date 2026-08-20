import { Module } from '@nestjs/common';
import { InvitesController, WorkspacesController } from './workspaces.controller';
import { InvitesService, WorkspacesService } from './workspaces.service';

/**
 * Workspaces & memberships API (EVT-42) — creation, rename, member
 * management, and single-use invitations. Distinct from the tenant-context
 * plumbing in this same `workspace/` directory (`WorkspaceContextGuard`,
 * `WorkspaceWriteGuard`, `default-workspace.ts`), which is wired directly
 * into `AppModule` as global guards rather than through a module — see
 * those files' doc comments.
 */
@Module({
  controllers: [WorkspacesController, InvitesController],
  providers: [WorkspacesService, InvitesService],
  exports: [WorkspacesService, InvitesService],
})
export class WorkspaceModule {}
