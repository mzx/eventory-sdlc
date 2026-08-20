import { UserStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

/**
 * The only statuses an admin action can SET via `PATCH /api/users/:id/status`
 * (EVT-42 round-2 security review, MAJOR) — `pending` dropped. Since
 * EVT-42's auth rework, `pending` is an inert legacy status with no gating
 * effect (see `UserStatus`'s schema doc comment); admins have exactly two
 * meaningful actions here — `approved` (lift a suspension) or `rejected`
 * (the suspend/ban semantic, the one status `JwtAuthGuard` still blocks on
 * every route). Accepting `pending` as a settable value invited exactly the
 * confusion the review flagged: an admin "un-approving" someone to
 * `pending` looked like a suspension but did nothing.
 */
const SETTABLE_STATUSES = [UserStatus.approved, UserStatus.rejected] as const;

export class UpdateUserStatusDto {
  /** New status — `approved` | `rejected` only (see {@link SETTABLE_STATUSES}'s doc comment). */
  @IsIn(SETTABLE_STATUSES)
  status!: UserStatus;
}
