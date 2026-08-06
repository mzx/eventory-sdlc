import type { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'google-id-1',
    displayName: 'Alice',
    emails: [{ value: 'alice@example.com', verified: true }],
    photos: [{ value: 'https://example.com/pic.png' }],
    ...overrides,
  } as unknown as Profile;
}

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  beforeEach(() => {
    // Constructed without real GOOGLE_CLIENT_ID/SECRET env vars — must not throw.
    strategy = new GoogleStrategy();
  });

  it('constructs without configured Google credentials (dev/test boot)', () => {
    expect(strategy).toBeDefined();
  });

  it('normalizes a Google profile into a GoogleProfile and calls done(null, profile)', () => {
    const done = jest.fn();
    strategy.validate('access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(null, {
      googleId: 'google-id-1',
      email: 'alice@example.com',
      name: 'Alice',
      picture: 'https://example.com/pic.png',
    });
  });

  it('falls back to null name/picture when the profile omits them', () => {
    const done = jest.fn();
    strategy.validate('a', 'r', makeProfile({ displayName: '', photos: [] }), done);

    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ name: null, picture: null }));
  });

  it('calls done(error) when the Google profile has no email', () => {
    const done = jest.fn();
    strategy.validate('a', 'r', makeProfile({ emails: [] }), done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
  });
});
