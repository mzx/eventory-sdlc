import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { RequestWithWorkspace } from './workspace-context';

/**
 * Route-level guard for mutating endpoints (EVT-40, operator decision
 * 2026-08-20: viewer role) — apply via `@UseGuards(WorkspaceWriteGuard)` on
 * every POST/PATCH/DELETE handler in a tenant-scoped module. A single
 * reusable guard rather than a per-endpoint `if (role === 'viewer') throw`,
 * per the task's explicit instruction.
 *
 * Relies on `WorkspaceContextGuard` (global, runs first) having already
 * attached `request.workspace`. When `request.workspace` is `null` (no
 * resolvable workspace), this guard does NOT throw — that case is instead
 * surfaced as a 403 by `@CurrentWorkspace()` once the handler's parameters
 * are resolved, which runs after guards. Either path ends at the same 403.
 *
 * Coverage as of EVT-41: applied to every mutating route in Items, Photos,
 * Locations (create/rename/move/delete), Categories (create), Projects
 * (create/update/delete/BOM lines/backflush), and Shopping List
 * (create-manual/restock) — the full "viewer reads everything, 403 on every
 * mutation" contract now holds app-wide across every module these two tasks
 * cover. Tags has no mutating endpoint of its own (tags are only created
 * transitively via `ItemsService`/`TagsService.upsertMany`, which is scoped
 * to the caller's workspace).
 */
@Injectable()
export class WorkspaceWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithWorkspace>();
    if (request.workspace?.role === WorkspaceRole.viewer) {
      throw new ForbiddenException('Viewers cannot modify workspace data');
    }
    return true;
  }
}
