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
import { CreateItemDto } from './create-item.dto';
import { ItemsService } from './items.service';
import { ListItemsQueryDto } from './list-items-query.dto';
import { UpdateItemDto } from './update-item.dto';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  /**
   * GET /api/items?search=&tag=&locationId=
   *
   * List items, newest first. All query params are optional filters:
   * - `search` — ILIKE against name, description, and properties JSONB.
   * - `tag`    — items carrying a tag with this exact name.
   * - `locationId` — items in this location or any descendant (subtree).
   */
  @Get()
  list(@Query() query: ListItemsQueryDto) {
    return this.itemsService.list(query);
  }

  /**
   * GET /api/items/by-qr/:qr
   *
   * Resolve a QR token to an item or a location.
   * Returns `{ kind: "item", item }` or `{ kind: "location", location }`.
   * 404 when the token matches neither table.
   *
   * NOTE: This route MUST be declared before `/:id` so NestJS doesn't
   * treat "by-qr" as a UUID and route it to `findById`.
   */
  @Get('by-qr/:qr')
  findByQr(@Param('qr') qr: string) {
    return this.itemsService.findByQr(qr);
  }

  /**
   * GET /api/items/:id
   *
   * Full item detail: photos, tags, location, category.
   * 404 when the item does not exist.
   */
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.findById(id);
  }

  /**
   * POST /api/items
   *
   * Create an item. Tags are upserted by name. Returns 201 with the new item.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateItemDto) {
    return this.itemsService.create(dto);
  }

  /**
   * PATCH /api/items/:id
   *
   * Partial update. When `tags` is provided, the tag list is fully replaced.
   * 404 when the item does not exist.
   */
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.itemsService.update(id, dto);
  }

  /**
   * DELETE /api/items/:id
   *
   * Delete an item (cascades photos and tag associations per schema).
   * Returns 204 No Content on success.
   * 404 when the item does not exist.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.itemsService.remove(id);
  }
}
