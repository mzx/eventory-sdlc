import { Controller, Get } from '@nestjs/common';
import { TagsService, TagWithCount } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  /** GET /api/tags — all tags with per-tag item counts, ordered by usage desc. */
  @Get()
  findAll(): Promise<TagWithCount[]> {
    return this.tagsService.findAll();
  }
}
