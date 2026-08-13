/**
 * Formats `iso` (an ISO-8601 timestamp) as a short relative-time string for
 * the item History section (EVT-25 AC 6) — "just now", "5m ago", "3h ago",
 * "2d ago" — falling back to an absolute date once it's a week or older (a
 * relative string that far back reads worse than just seeing the date).
 *
 * `now` is injectable for deterministic tests; defaults to `Date.now()`.
 * A future/skewed `iso` (negative diff) is clamped to "just now" rather than
 * showing a negative duration.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));

  if (diffSeconds < 60) return 'just now';

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(iso).toLocaleDateString();
}
