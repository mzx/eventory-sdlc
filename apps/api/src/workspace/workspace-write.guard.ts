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
