import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { ListMovementsQueryDto } from '../stock-movements/list-movements-query.dto';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { WorkspaceWriteGuard } from '../workspace/workspace-write.guard';
import { CreateLocationDto } from './create-location.dto';
import { LocationsService } from './locations.service';
import { MoveLocationDto } from './move-location.dto';
import { RenameLocationDto } from './rename-location.dto';

@Controller('locations')
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  /**
   * GET /api/locations — flat list ordered by path, scoped to the caller's
   * active workspace (EVT-41).
   */
  @Get()
  findAll(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.locationsService.findAll(workspace.id);
  }

  /**
   * GET /api/locations/:id — detail with children, items, breadcrumb. 404
   * when the location does not exist OR belongs to a different workspace
   * (EVT-41).
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentWorkspace() workspace: WorkspaceContext) {
    return this.locationsService.findOne(id, workspace.id);
  }

  /**
   * GET /api/locations/:id/movements?page=&pageSize= — a container's own
   * re-parent history, newest first (EVT-30 AC 3). 404 when the location
   * doesn't exist, is not a `container`, or belongs to a different
   * workspace (EVT-41).
   *
   * `ParseUUIDPipe` on `id` (EVT-30 review round 2, finding 2) — without it
   * a non-UUID id reached Prisma's `@db.Uuid` column and raised P2023 → 500
   * instead of a clean 400.
   */
  @Get(':id/movements')
  listMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMovementsQueryDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.stockMovementsService.listForContainer(id, query, workspace.id);
  }

  /**
   * POST /api/locations — create a location (root or child of parentId) in
   * the caller's active workspace (EVT-41). Mutating — a `viewer` gets 403.
   */
  @Post()
  @UseGuards(WorkspaceWriteGuard)
  create(@Body() body: CreateLocationDto, @CurrentWorkspace() workspace: WorkspaceContext) {
    return this.locationsService.create(body, workspace.id);
  }

  /**
   * POST /api/locations/:id/move — "Move to…" (EVT-30 AC 2). `toParentId:
   * null` (or omitted) moves the container to root. Container-only (400 on
   * an `area`); rejects a cycle into itself/its own descendants (422, AC 4).
   * 404 when the container or destination does not exist OR belongs to a
   * different workspace (EVT-41). The advisory lock serializing this
   * mutation is now per-workspace (EVT-41 AC 2) — see
   * `LocationsService`'s `LOCATION_TREE_LOCK_KEY` doc comment. Mutating — a
   * `viewer` gets 403.
   *
   * `ParseUUIDPipe` on `id` (EVT-30 review round 2, finding 2) — see
   * `listMovements`'s doc comment for the rationale.
   */
  @Post(':id/move')
  @UseGuards(WorkspaceWriteGuard)
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MoveLocationDto,
    @CurrentUser() user: AuthenticatedUser | null,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.locationsService.moveContainer(id, body.toParentId ?? null, workspace.id, user?.id);
  }

  /**
   * PATCH /api/locations/:id — rename + atomic descendant path rewrite. 404
   * when the location does not exist OR belongs to a different workspace
   * (EVT-41). Mutating — a `viewer` gets 403.
   */
  @Patch(':id')
  @UseGuards(WorkspaceWriteGuard)
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameLocationDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.locationsService.rename(id, body.name, workspace.id);
  }

  /**
   * DELETE /api/locations/:id — only when no children; items become
   * unlocated. 404 when the location does not exist OR belongs to a
   * different workspace (EVT-41). Mutating — a `viewer` gets 403.
   */
  @Delete(':id')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<void> {
    await this.locationsService.remove(id, workspace.id);
  }
}
