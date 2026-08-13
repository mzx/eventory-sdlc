import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /api/locations/:id body.
 *
 * Converted from a plain interface to a class-validator class (EVT-30 review
 * round 2, finding 3) — see `CreateLocationDto`'s doc comment for the
 * rationale (a plain interface is invisible to the global `ValidationPipe`).
 */
export class RenameLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
