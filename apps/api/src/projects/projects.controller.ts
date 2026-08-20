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
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { WorkspaceWriteGuard } from '../workspace/workspace-write.guard';
import { BackflushDto } from './backflush.dto';
import { CreateBomLineDto } from './create-bom-line.dto';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsQueryDto } from './list-projects-query.dto';
import { ProjectsService } from './projects.service';
import { UpdateBomLineDto } from './update-bom-line.dto';
import { UpdateProjectDto } from './update-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * GET /api/projects?status= — list, newest first, with BOM line counts,
   * scoped to the caller's active workspace (EVT-41).
   */
  @Get()
  list(@Query() query: ListProjectsQueryDto, @CurrentWorkspace() workspace: WorkspaceContext) {
    return this.projectsService.list(query, workspace.id);
  }

  /**
   * GET /api/projects/:id — detail with BOM lines incl. linked item summary.
   * 404 when the project does not exist OR belongs to a different workspace
   * (EVT-41).
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentWorkspace() workspace: WorkspaceContext) {
    return this.projectsService.findOne(id, workspace.id);
  }

  /**
   * POST /api/projects — create a project in the caller's active workspace
   * (EVT-41). Returns 201 with the new project. Mutating — a `viewer` gets
   * 403.
   */
  @Post()
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto, @CurrentWorkspace() workspace: WorkspaceContext) {
    return this.projectsService.create(dto, workspace.id);
  }

  /**
   * PATCH /api/projects/:id — partial update. 404 when the project does not
   * exist OR belongs to a different workspace (EVT-41). Mutating — a
   * `viewer` gets 403.
   */
  @Patch(':id')
  @UseGuards(WorkspaceWriteGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.update(id, dto, workspace.id);
  }

  /**
   * DELETE /api/projects/:id — deletes the project; BOM lines cascade. 404
   * when the project does not exist OR belongs to a different workspace
   * (EVT-41). Mutating — a `viewer` gets 403.
   */
  @Delete(':id')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<void> {
    return this.projectsService.remove(id, workspace.id);
  }

  /**
   * POST /api/projects/:id/bom — add a BOM line, either linked to an item
   * (`itemId`, name copied) or free text (`name`). A foreign-workspace
   * `itemId` is rejected with 404 (EVT-41 AC 3). Returns 201. Mutating — a
   * `viewer` gets 403.
   */
  @Post(':id/bom')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.CREATED)
  addBomLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBomLineDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.addBomLine(id, dto, workspace.id);
  }

  /**
   * PATCH /api/projects/:id/bom/:lineId — edit a BOM line. 404 when the
   * project does not exist OR belongs to a different workspace (EVT-41).
   * Mutating — a `viewer` gets 403.
   */
  @Patch(':id/bom/:lineId')
  @UseGuards(WorkspaceWriteGuard)
  updateBomLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateBomLineDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.updateBomLine(id, lineId, dto, workspace.id);
  }

  /**
   * DELETE /api/projects/:id/bom/:lineId — remove a BOM line. 404 when the
   * project does not exist OR belongs to a different workspace (EVT-41).
   * Mutating — a `viewer` gets 403.
   */
  @Delete(':id/bom/:lineId')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBomLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<void> {
    return this.projectsService.removeBomLine(id, lineId, workspace.id);
  }

  /**
   * GET /api/projects/:id/availability — clear-to-build check + kitting
   * pick-list data (EVT-29 AC 1, AC 2, AC 3): per-line on-hand, storage
   * location, and status (`ok`/`short`/`untracked`), plus a `clearToBuild`
   * summary. Read-only, point-in-time (see `ProjectAvailability.asOf`). 404
   * when the project does not exist OR belongs to a different workspace
   * (EVT-41).
   */
  @Get(':id/availability')
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.availability(id, workspace.id);
  }

  /**
   * GET /api/projects/:id/backflush-preview — read-only confirmation-screen
   * data for completing a project (EVT-28 AC 1): per-line on-hand,
   * suggested consume quantity, shortage flags, and whether this project was
   * already backflushed (idempotency guard, AC 6). 404 when the project does
   * not exist OR belongs to a different workspace (EVT-41).
   */
  @Get(':id/backflush-preview')
  previewBackflush(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.previewBackflush(id, workspace.id);
  }

  /**
   * POST /api/projects/:id/backflush — confirms the backflush: writes one
   * `build` movement per consumed line and marks the project `completed`,
   * atomically (EVT-28 AC 2). 409s if already backflushed unless
   * `confirmAgain` is set (AC 6). 404 when the project does not exist OR
   * belongs to a different workspace (EVT-41). `createdById` is stamped from
   * the caller's session onto every `build` movement (mirrors
   * `ItemsController.create`). Mutating — a `viewer` gets 403.
   */
  @Post(':id/backflush')
  @UseGuards(WorkspaceWriteGuard)
  backflush(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BackflushDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.projectsService.backflush(id, dto, workspace.id, user.id);
  }
}
