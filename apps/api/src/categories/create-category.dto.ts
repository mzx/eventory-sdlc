export class CreateCategoryDto {
  /** Human-readable display name, e.g. "Hand Tools". */
  name!: string;
  /** UUID of the parent category; omit or set to null for a root category. */
  parentId?: string | null;
}
