import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCategoryDto {
  /** Human-readable display name, e.g. "Hand Tools". Must not be empty. */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** UUID of the parent category; omit or set to null for a root category. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
