import { ExecutionContext, Injectable, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard, IAuthModuleOptions } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  AUTH_COOKIE_NAME,
  AuthService,
  PublicUser,
  SignInNotAllowedError,
  toPublicUser,
} from './auth.service';
import { AllowPending, AuthenticatedUser, CurrentUser, Public } from './decorators';
import { GoogleProfile } from './google.strategy';

/**
 * `GET /api/auth/google?invite=<rawToken>` (EVT-45) — a household member
 * following an invite link needs their invite token to survive the round
 * trip to Google and back, so the callback can let a non-allowlisted BRAND
 * NEW sign-in through (`AuthService.upsertFromGoogleProfile`'s `inviteToken`
 * param — "the invite IS the authorization").
 *
 * Forwards `?invite=` as the OAuth `state` param. `GoogleStrategy` is NOT
 * configured with `state: true` (that flavor requires session storage,
 * which this JWT-cookie-only app doesn't have) — passport-oauth2 then treats
 * a custom `state` string passed here as opaque, stateless passthrough data:
 * sent as-is to Google, echoed back verbatim as `req.query.state` on the
 * callback, no session/CSRF bookkeeping involved. A missing/empty `invite`
 * query param sends no `state` at all — unaffected, existing behavior.
 */
@Injectable()
export class GoogleSignInGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions | undefined {
    const request = context.switchToHttp().getRequest<Request>();
    const invite = request.query?.invite;
    return typeof invite === 'string' && invite.length > 0
      ? ({ state: invite } as IAuthModuleOptions)
      : undefined;
  }
}

/** A self-contained, dependency-free HTML page — no build step, no web-app route needed. */
function inviteOnlyPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invite only — Eventory</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; text-align: center; color: #222; }
  h1 { font-size: 1.25rem; }
  p { color: #555; line-height: 1.5; }
</style>
</head>
<body>
<h1>This instance is invite-only</h1>
<p>Your Google account isn't on the allowlist for this Eventory instance, and no valid invitation was presented.</p>
<p>Ask a household member with access to send you an invite link, or contact the instance operator.</p>
</body>
</html>`;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /api/auth/google
   *
   * Kicks off the Google OAuth redirect. Handled entirely by
   * `GoogleSignInGuard` (passport-google-oauth20) — this handler never
   * actually runs its body.
   */
  @Public()
  @UseGuards(GoogleSignInGuard)
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
   * httpOnly session cookie, then redirects to the web app.
   *
   * EVT-42: a brand-new sign-in is always `approved` now (the `pending`
   * landing page is retired — see `AuthService.upsertFromGoogleProfile`'s
   * doc comment), so the only status-specific redirect left is `rejected`
   * (an explicit instance-admin ban). Whether the signed-in user has any
   * workspace membership yet — and therefore whether the web app should
   * show "create a workspace or redeem an invite" — is a client-side
   * concern (`GET /api/workspaces`), not something this redirect encodes.
   *
   * EVT-45: `req.query.state` carries the raw invite token forwarded by
   * `GoogleSignInGuard` above (if any), letting a non-allowlisted invitee's
   * FIRST sign-in through. `upsertFromGoogleProfile` throws
   * `SignInNotAllowedError` for a refused sign-in — caught here to render
   * the invite-only page directly (403, no cookie, no redirect, no `User`
   * row) rather than letting it bubble into a generic 500/JSON error body.
   */
  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const profile = req.user as GoogleProfile;
    const inviteToken = typeof req.query.state === 'string' ? req.query.state : undefined;

    let user;
    try {
      user = await this.authService.upsertFromGoogleProfile(profile, undefined, inviteToken);
    } catch (err) {
      if (err instanceof SignInNotAllowedError) {
        res.status(403).type('html').send(inviteOnlyPageHtml());
        return;
      }
      throw err;
    }

    const token = this.authService.signToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, this.authService.cookieOptions());

    const webBase = this.authService.webBase();
    const destination = user.status === UserStatus.rejected ? `${webBase}/rejected` : webBase;
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
