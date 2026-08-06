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
} from '@nestjs/common';
import { CreateBomLineDto } from './create-bom-line.dto';
import { CreateProjectDto } from './create-project.dto';
import { ListProjectsQueryDto } from './list-projects-query.dto';
import { ProjectsService } from './projects.service';
import { UpdateBomLineDto } from './update-bom-line.dto';
import { UpdateProjectDto } from './update-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** GET /api/projects?status= — list, newest first, with BOM line counts. */
  @Get()
  list(@Query() query: ListProjectsQueryDto) {
    return this.projectsService.list(query);
  }

  /** GET /api/projects/:id — detail with BOM lines incl. linked item summary. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOne(id);
  }

  /** POST /api/projects — create a project. Returns 201 with the new project. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  /** PATCH /api/projects/:id — partial update. 404 when the project does not exist. */
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  /** DELETE /api/projects/:id — deletes the project; BOM lines cascade. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projectsService.remove(id);
  }

  /**
   * POST /api/projects/:id/bom — add a BOM line, either linked to an item
   * (`itemId`, name copied) or free text (`name`). Returns 201.
   */
  @Post(':id/bom')
  @HttpCode(HttpStatus.CREATED)
  addBomLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBomLineDto) {
    return this.projectsService.addBomLine(id, dto);
  }

  /** PATCH /api/projects/:id/bom/:lineId — edit a BOM line. */
  @Patch(':id/bom/:lineId')
  updateBomLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateBomLineDto,
  ) {
    return this.projectsService.updateBomLine(id, lineId, dto);
  }

  /** DELETE /api/projects/:id/bom/:lineId — remove a BOM line. */
  @Delete(':id/bom/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBomLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<void> {
    return this.projectsService.removeBomLine(id, lineId);
  }
}
