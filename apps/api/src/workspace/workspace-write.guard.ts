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
 * ⚠️ **Coverage is NOT complete as of EVT-40.** This guard is applied ONLY
 * to the Items and Photos modules' mutating routes — the task's explicit
 * scope. The following mutating (and, for the first one, also unscoped
 * READING) endpoints have NEITHER `WorkspaceWriteGuard` NOR any workspace
 * resolution at all, and remain reachable by a `viewer` and by a caller in
 * a different workspace, until EVT-41 lands:
 *   - `GET /api/locations/by-qr/:qr` (`LocationsService.findByQr`) — returns
 *     full location detail with zero workspace check (pre-existing).
 *   - `POST /api/shopping-list`, `POST /api/shopping-list/:id/restock`
 *     (`ShoppingListService`) — mutate `Item.quantity` on the same rows
 *     Items/Photos now protect, with no guard and no workspace scoping on
 *     the target item lookup.
 *   - `POST /api/projects/:id/backflush` and Projects' other mutating routes
 *     (`ProjectsService`) — same gap: consumes/adjusts Item stock with no
 *     workspace check.
 * Do NOT treat "viewer role" or "cross-workspace isolation" as a completed,
 * app-wide property until EVT-41 closes these — they hold ONLY for the
 * Items/Photos/storage/QR surfaces this task covers.
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
