import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { BackflushLineDto } from './backflush-line.dto';

/**
 * `POST /:id/backflush` request body (EVT-28). Confirms the backflush
 * previewed via `GET /:id/backflush-preview`: writes one `build` movement
 * per consumed line and marks the project `completed`, atomically.
 */
export class BackflushDto {
  /**
   * Per-line consumption decisions. Lines omitted here (or resolving to a
   * free-text BOM line) are skipped — never written. May be empty (e.g. a
   * project whose BOM is entirely free text still completes, with nothing
   * to consume).
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackflushLineDto)
  lines!: BackflushLineDto[];

  /**
   * Idempotency guard (EVT-28 risk: double-backflush on status flapping).
   * When the project already has recorded `build` movements, the request is
   * rejected with 409 unless this is explicitly `true` — forcing the caller
   * (the web confirmation screen) to make "consume again" an explicit
   * choice rather than a silent re-application.
   */
  @IsOptional()
  @IsBoolean()
  confirmAgain?: boolean;
}
