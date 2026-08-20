import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { WorkspaceWriteGuard } from '../workspace/workspace-write.guard';
import { CategoriesService, CategoryRow } from './categories.service';
import { CreateCategoryDto } from './create-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * GET /api/categories — flat list ordered by materialized path, scoped to
   * the caller's active workspace (EVT-41).
   */
  @Get()
  findAll(@CurrentWorkspace() workspace: WorkspaceContext): Promise<CategoryRow[]> {
    return this.categoriesService.findAll(workspace.id);
  }

  /**
   * POST /api/categories — create a root or child category in the caller's
   * active workspace (EVT-41).
   * Returns 201 Created with the new category row.
   * Returns 409 Conflict when a sibling with the same slugified name exists.
   * Returns 404 Not Found when the specified parentId does not exist OR
   * belongs to a different workspace.
   * Mutating — a `viewer` gets 403.
   */
  @Post()
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<CategoryRow> {
    return this.categoriesService.create(dto, workspace.id);
  }
}
