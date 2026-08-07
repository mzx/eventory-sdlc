/**
 * Extracts the app-relative `/r/:token` path from a decoded QR payload.
 * Stickers encode an absolute URL (`${PUBLIC_BASE_URL}/r/:token`, see
 * apps/api QrService), but the scanner also accepts an already-relative
 * path so it keeps working against stickers printed under a different
 * `PUBLIC_BASE_URL` than the one currently deployed. Anything else
 * (a foreign QR code) is rejected — returns `null`.
 */
export function extractScanPath(text: string): string | null {
  const scanPathPattern = /^\/r\/[^/?#]+$/;
  if (scanPathPattern.test(text)) {
    return text;
  }
  try {
    const url = new URL(text);
    if (scanPathPattern.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    // Not an absolute URL — falls through to null below.
  }
  return null;
}
