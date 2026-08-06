import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

/** Normalized shape `AuthService.upsertFromGoogleProfile` consumes. */
export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Fallback OAuth client config used when `GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` are unset (dev/test boot,
 * or CI). `passport-google-oauth20`'s `Strategy` constructor throws if these
 * are missing entirely, and this strategy is instantiated eagerly as a Nest
 * provider at app bootstrap — so, same rationale as `AiService`'s no-key
 * stub path, the app must still boot cleanly without real credentials. The
 * placeholder values are never valid against Google's OAuth endpoint; they
 * only exist to satisfy the constructor.
 */
const UNCONFIGURED = 'unconfigured';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || UNCONFIGURED,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || UNCONFIGURED,
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  /**
   * Called by passport once Google has authenticated the user and returned
   * their profile. Normalizes it to {@link GoogleProfile} and hands it to
   * `done`, which passport attaches to `req.user` for the callback route
   * handler to read.
   */
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google profile did not include an email address'));
      return;
    }
    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      name: profile.displayName || null,
      picture: profile.photos?.[0]?.value || null,
    };
    done(null, googleProfile);
  }
}
