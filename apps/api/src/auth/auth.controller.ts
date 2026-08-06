import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_NAME, AuthService, PublicUser, toPublicUser } from './auth.service';
import { AllowPending, AuthenticatedUser, CurrentUser, Public } from './decorators';
import { GoogleProfile } from './google.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /api/auth/google
   *
   * Kicks off the Google OAuth redirect. Handled entirely by
   * `AuthGuard('google')` (passport-google-oauth20) — this handler never
   * actually runs its body.
   */
  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google')
  googleAuth(): void {
    // Intentionally empty — passport intercepts the request and redirects
    // to Google before this body would ever execute.
  }

  /**
   * GET /api/auth/google/callback
   *
   * Google redirects here with the authenticated profile (verified by
   * `AuthGuard('google')` → `GoogleStrategy.validate`). Upserts the User row
   * (first-ever user becomes admin + approved), signs a JWT, sets the
   * httpOnly session cookie, then redirects to the web app based on the
   * user's approval status.
   */
  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const profile = req.user as GoogleProfile;
    const user = await this.authService.upsertFromGoogleProfile(profile);
    const token = this.authService.signToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, this.authService.cookieOptions());

    const webBase = this.authService.webBase();
    const destination =
      user.status === UserStatus.pending
        ? `${webBase}/pending`
        : user.status === UserStatus.rejected
          ? `${webBase}/rejected`
          : webBase;
    res.redirect(destination);
  }

  /**
   * GET /api/auth/me
   *
   * Always resolves 200 — `AllowPending()` so `JwtAuthGuard` never throws
   * here, even with no/invalid cookie. Returns the caller's own user row
   * (any status, so a pending/rejected user can still see their own state)
   * or `null` when signed out.
   *
   * Uses `@Res()` (non-passthrough) and calls `res.json(...)` explicitly
   * rather than `return null` — Nest's Express adapter treats a `null`
   * *return value* as `isNil` and calls `response.send()` with NO body at
   * all (empty response, no `application/json` Content-Type), not a literal
   * JSON `null`. Callers doing `await res.json()` on an empty body would
   * throw; `res.json(null)` always sends the literal 4-byte `null` body
   * with the correct Content-Type.
   */
  @AllowPending()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser | null, @Res() res: Response): void {
    const body: PublicUser | null = user ? toPublicUser(user) : null;
    res.status(200).json(body);
  }

  /**
   * GET /api/auth/logout
   *
   * Clears the session cookie and redirects to the web base.
   */
  @Public()
  @Get('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    res.redirect(this.authService.webBase());
  }
}
