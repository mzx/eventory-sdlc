import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import type { CookieOptions } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ensureDefaultWorkspaceMembership } from '../workspace/default-workspace';
import { GoogleProfile } from './google.strategy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the httpOnly session cookie set on a successful Google callback. */
export const AUTH_COOKIE_NAME = 'eventory_session';

/** Fallback WEB origin when `WEB_BASE` is not configured (dev default). */
export const DEFAULT_WEB_BASE = 'http://localhost:5173';

/**
 * Fallback JWT signing secret used when `JWT_SECRET` is not configured
 * (dev/test boot). Same rationale as `GoogleStrategy`'s `UNCONFIGURED`
 * placeholder — never use this in production; the operator must set
 * `JWT_SECRET` for real deployments. `resolveJwtSecret` below refuses to
 * fall back to this value when `NODE_ENV === 'production'`.
 */
export const DEFAULT_JWT_SECRET = 'dev-insecure-jwt-secret-change-me';

/**
 * `.env.prod.example`'s JWT_SECRET line used to ship this non-empty
 * placeholder value before EVT-19 review round 2 changed it to ship empty
 * (so compose's `${JWT_SECRET:?}` fails fast until an operator fills it
 * in). Rejected here too, alongside `DEFAULT_JWT_SECRET`, so any `.env.prod`
 * copied from that older example — before the operator got around to
 * replacing the placeholder — still fails closed in production instead of
 * signing every session JWT with a secret anyone can read in this repo's
 * git history.
 */
export const REJECTED_PLACEHOLDER_JWT_SECRETS = new Set<string>([
  DEFAULT_JWT_SECRET,
  'change-me-to-a-long-random-secret',
]);

/**
 * Resolves the secret `JwtModule` signs/verifies session cookies with.
 *
 * - `JWT_SECRET` set to anything other than a known placeholder → used
 *   as-is.
 * - Otherwise (unset, or explicitly set to a known placeholder — the dev
 *   default or the historical `.env.prod.example` string): allowed in
 *   dev/test, but throws at bootstrap when `NODE_ENV === 'production'` —
 *   a production deployment that forgot to configure `JWT_SECRET` must
 *   fail to start rather than silently sign every session with a secret
 *   published in this repo's source (EVT-14 review round 2, finding 1;
 *   placeholder reject-list extended EVT-19 review round 2, finding 1).
 *
 * Takes `env` as a parameter (defaulting to `process.env`) so it's a pure,
 * directly-testable function rather than reaching for the global at every
 * call site.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JWT_SECRET;
  if (configured && !REJECTED_PLACEHOLDER_JWT_SECRETS.has(configured)) {
    return configured;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be set to a non-default value when NODE_ENV=production. ' +
        'Refusing to boot signing sessions with a publicly known placeholder secret.',
    );
  }
  return DEFAULT_JWT_SECRET;
}

/** Session lifetime — 30 days, matching the cookie's `maxAge`. */
const TOKEN_EXPIRY = '30d';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Parses `EVENTORY_ADMIN_EMAILS` — a comma-separated allowlist of emails
 * that ALWAYS land `admin` + `approved` on sign-in (see
 * `upsertFromGoogleProfile`), independent of the `User` table's row count.
 *
 * This is the operator bootstrap mechanism (EVT-20): the count-based
 * first-user auto-promotion below can be defeated by any pre-existing row
 * (e.g. a seeded/dev fixture, or a stale row left over in a persisted
 * Docker volume) consuming the "first user" slot before the real operator
 * ever signs in. Setting this env var to the operator's own Google account
 * email guarantees they get promoted on sign-in regardless of what else is
 * in the table — and doubles as the recovery path for an already-stuck
 * instance: set the var, then sign in (or sign in again) with that account.
 *
 * Case-insensitive, trims whitespace, ignores empty entries.
 */
export function parseAdminAllowlist(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

/** Safe-to-return-to-the-browser projection of `User` — omits `googleId`. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  const { id, email, name, picture, status, role, createdAt } = user;
  return { id, email, name, picture, status, role, createdAt };
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Upserts a `User` row from a verified Google profile.
   *
   * - Matched first by `googleId`. Only falls back to matching by `email`
   *   when no row owns this `googleId` — and even then, if the matched row
   *   already has a DIFFERENT `googleId` bound, the sign-in is refused
   *   rather than silently rebinding it. Silently rebinding on an email
   *   match is an account-takeover path: anyone who can present a Google
   *   profile with a given email (see `GoogleStrategy`'s `email_verified`
   *   check, which is the other half of this defense) would otherwise
   *   hijack whatever existing row — including an approved admin's — has
   *   that email (EVT-14 review round 2, finding 2).
   * - The FIRST user to EVER sign in via Google is auto-promoted to `admin`
   *   + `approved` so the household is never locked out waiting for an
   *   admin to approve the very first admin. "First" only counts rows that
   *   have a `googleId` bound (EVT-20 AC2) — a seeded/dev/placeholder row
   *   created directly in the DB, with no `googleId`, must not consume this
   *   slot before a real operator ever signs in. The count-then-create is
   *   wrapped in an interactive transaction so two concurrent first
   *   sign-ins can't both observe `count() === 0` and both become admin
   *   (EVT-14 review round 2, finding 5).
   * - `EVENTORY_ADMIN_EMAILS` (see `parseAdminAllowlist`) is the reliable
   *   operator bootstrap mechanism: any email on that allowlist ALWAYS lands
   *   `admin` + `approved` on sign-in — on first creation, and retroactively
   *   promoted on a later sign-in if they already exist as `pending` /
   *   `rejected` / plain `user` — independent of the first-user count
   *   (EVT-20 AC1). This is what recovers an already-stuck instance: set
   *   the env var, then have the operator sign in (again).
   * - Every sign-in (new or returning) stamps `lastLoginAt`.
   */
  async upsertFromGoogleProfile(
    profile: GoogleProfile,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<User> {
    const adminAllowlist = parseAdminAllowlist(env.EVENTORY_ADMIN_EMAILS);
    const isAllowlistedAdmin = adminAllowlist.has(profile.email.toLowerCase());

    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });

    if (byGoogleId) {
      const needsPromotion =
        isAllowlistedAdmin &&
        !(byGoogleId.role === UserRole.admin && byGoogleId.status === UserStatus.approved);
      const updated = await this.prisma.user.update({
        where: { id: byGoogleId.id },
        data: {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          lastLoginAt: new Date(),
          ...(needsPromotion && {
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: new Date(),
          }),
        },
      });
      if (needsPromotion) {
        // EVT-40: promotion to admin+approved must also grant Default
        // Workspace access — see ensureDefaultWorkspaceMembership's doc
        // comment.
        await ensureDefaultWorkspaceMembership(this.prisma, updated.id, WorkspaceRole.owner);
      }
      return updated;
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });

    if (byEmail) {
      if (byEmail.googleId) {
        // We already ruled out a match on THIS profile's googleId above, so
        // if we're here the email-matched row is bound to a DIFFERENT
        // Google account. Never overwrite it.
        throw new UnauthorizedException(
          'This email address is already linked to a different Google account.',
        );
      }
      const needsPromotion =
        isAllowlistedAdmin &&
        !(byEmail.role === UserRole.admin && byEmail.status === UserStatus.approved);
      const updated = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: profile.googleId,
          name: profile.name,
          picture: profile.picture,
          lastLoginAt: new Date(),
          ...(needsPromotion && {
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: new Date(),
          }),
        },
      });
      if (needsPromotion) {
        // EVT-40: see the byGoogleId branch above.
        await ensureDefaultWorkspaceMembership(this.prisma, updated.id, WorkspaceRole.owner);
      }
      return updated;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const isFirstOAuthUser = (await tx.user.count({ where: { googleId: { not: null } } })) === 0;
      const promote = isFirstOAuthUser || isAllowlistedAdmin;

      return tx.user.create({
        data: {
          googleId: profile.googleId,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          lastLoginAt: new Date(),
          ...(promote && {
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: new Date(),
          }),
        },
      });
    });
    if (created.status === UserStatus.approved) {
      // EVT-40: the bootstrap admin (first-ever sign-in) or an
      // EVENTORY_ADMIN_EMAILS-allowlisted new sign-in — see the byGoogleId
      // branch above.
      await ensureDefaultWorkspaceMembership(this.prisma, created.id, WorkspaceRole.owner);
    }
    return created;
  }

  /** Signs a JWT carrying the minimal claims `JwtAuthGuard` needs. */
  signToken(user: Pick<User, 'id' | 'email' | 'role' | 'status'>): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
    return this.jwtService.sign(payload, { expiresIn: TOKEN_EXPIRY });
  }

  /** Verifies a JWT, returning `null` (never throwing) on any failure. */
  async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  /**
   * Resolves the current DB row for a session cookie's token.
   *
   * Re-reads from the DB rather than trusting the JWT payload's
   * `role`/`status` — an admin approving/promoting a user takes effect
   * immediately, without the affected user having to wait for their
   * existing JWT to expire. Returns `null` for a missing/invalid/expired
   * token, or a token whose `sub` no longer resolves to a user (never
   * throws).
   */
  async getUserFromToken(token: string | undefined): Promise<User | null> {
    if (!token) {
      return null;
    }
    const payload = await this.verifyToken(token);
    if (!payload) {
      return null;
    }
    return this.prisma.user.findUnique({ where: { id: payload.sub } });
  }

  /** httpOnly + secure + SameSite=Lax cookie options for the session cookie. */
  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    };
  }

  /** The WEB origin OAuth callback / logout redirects land on. */
  webBase(): string {
    const configured = process.env.WEB_BASE;
    return configured && configured.length > 0 ? configured : DEFAULT_WEB_BASE;
  }
}
