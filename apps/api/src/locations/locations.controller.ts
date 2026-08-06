import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateLocationDto, LocationsService, RenameLocationDto } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /** GET /api/locations — flat list ordered by path. */
  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  /**
   * GET /api/locations/by-qr/:qr — must be declared BEFORE :id so NestJS does
   * not try to treat "by-qr" as a UUID.
   */
  @Get('by-qr/:qr')
  findByQr(@Param('qr') qr: string) {
    return this.locationsService.findByQr(qr);
  }

  /** GET /api/locations/:id — detail with children, items, breadcrumb. */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locationsService.findOne(id);
  }

  /** POST /api/locations — create a location (root or child of parentId). */
  @Post()
  create(@Body() body: CreateLocationDto) {
    return this.locationsService.create(body);
  }

  /** PATCH /api/locations/:id — rename + atomic descendant path rewrite. */
  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: RenameLocationDto) {
    return this.locationsService.rename(id, body.name);
  }

  /** DELETE /api/locations/:id — only when no children; items become unlocated. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.locationsService.remove(id);
  }
}
