import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

const NOW = new Date('2026-08-12T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('renders "just now" for a timestamp under a minute old', () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
  });

  it('renders minutes ago for a timestamp under an hour old', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
  });

  it('renders hours ago for a timestamp under a day old', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW)).toBe('3h ago');
  });

  it('renders days ago for a timestamp under a week old', () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 24 * 60 * 60_000).toISOString(), NOW)).toBe(
      '2d ago',
    );
  });

  it('falls back to an absolute date once a week or older', () => {
    const eightDaysAgo = new Date(NOW - 8 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(eightDaysAgo, NOW)).toBe(new Date(eightDaysAgo).toLocaleDateString());
  });

  it('clamps a future/skewed timestamp to "just now" instead of a negative duration', () => {
    expect(formatRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('defaults `now` to the current time when omitted', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
  });
});
