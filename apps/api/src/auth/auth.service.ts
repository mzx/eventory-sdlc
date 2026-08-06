import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole, UserStatus } from '@prisma/client';
import type { CookieOptions } from 'express';
import { PrismaService } from '../prisma/prisma.service';
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
 * `JWT_SECRET` for real deployments.
 */
export const DEFAULT_JWT_SECRET = 'dev-insecure-jwt-secret-change-me';

/** Session lifetime — 30 days, matching the cookie's `maxAge`. */
const TOKEN_EXPIRY = '30d';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
   * - Matched first by `googleId`, falling back to `email` (covers the edge
   *   case of a row that predates a `googleId` change on Google's side).
   * - The FIRST user ever created is auto-promoted to `admin` + `approved`
   *   so the household is never locked out waiting for an admin to approve
   *   the very first admin.
   * - Every sign-in (new or returning) stamps `lastLoginAt`.
   */
  async upsertFromGoogleProfile(profile: GoogleProfile): Promise<User> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: profile.googleId,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          lastLoginAt: new Date(),
        },
      });
    }

    const isFirstUser = (await this.prisma.user.count()) === 0;

    return this.prisma.user.create({
      data: {
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        lastLoginAt: new Date(),
        ...(isFirstUser && {
          role: UserRole.admin,
          status: UserStatus.approved,
          approvedAt: new Date(),
        }),
      },
    });
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
