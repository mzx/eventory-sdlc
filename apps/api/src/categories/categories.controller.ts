import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CategoriesService, CategoryRow } from './categories.service';
import { CreateCategoryDto } from './create-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /** GET /api/categories — flat list ordered by materialized path. */
  @Get()
  findAll(): Promise<CategoryRow[]> {
    return this.categoriesService.findAll();
  }

  /**
   * POST /api/categories — create a root or child category.
   * Returns 201 Created with the new category row.
   * Returns 409 Conflict when a sibling with the same slugified name exists.
   * Returns 404 Not Found when the specified parentId does not exist.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCategoryDto): Promise<CategoryRow> {
    return this.categoriesService.create(dto);
  }
}
