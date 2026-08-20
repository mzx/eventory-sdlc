import { Controller, Get } from '@nestjs/common';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { TagsService, TagWithCount } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  /**
   * GET /api/tags — tags in the caller's active workspace, with per-tag
   * item counts, ordered by usage desc (EVT-40 round-2 review: this route
   * was unscoped before this fix).
   */
  @Get()
  findAll(@CurrentWorkspace() workspace: WorkspaceContext): Promise<TagWithCount[]> {
    return this.tagsService.findAll(workspace.id);
  }
}
