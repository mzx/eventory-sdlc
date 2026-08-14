import fs from 'node:fs';

/** `<short-sha> <YYYY-MM-DD>` — what `git archive`'s `export-subst` produces
 * from the root `VERSION` file's `$Format:%h %cs$` placeholder (`%cs` is
 * the committer date, short form). See `.gitattributes`. */
const VERSION_LINE_RE = /^([0-9a-f]{7,40}) (\d{4}-\d{2}-\d{2})$/;

export interface ParsedBuildVersion {
  sha: string;
  date: string;
}

/**
 * Reads `versionFilePath` (the repo-root `VERSION` file), tolerating a
 * missing file — a fresh clone always has one (it's tracked), but a
 * defensive `undefined` return keeps this from throwing during a build if
 * something unexpected removed it.
 */
export function readVersionFile(versionFilePath: string): string | undefined {
  try {
    return fs.readFileSync(versionFilePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Parses the contents of the root `VERSION` file into a short SHA + build
 * date, or `null` when it wasn't substituted by `git archive`.
 *
 * `export-subst` (see `.gitattributes`) only expands `$Format:...$` in the
 * copy produced BY `git archive` — a normal `git checkout`/clone (local
 * `vite dev`, dev-compose's bind-mounted source, or even a plain local
 * `vite build` run straight from the working tree) always sees the literal
 * placeholder text, which fails to match and returns `null` here. That's
 * deliberate: the only path that ever satisfies the pattern below is
 * `deploy.sh`'s `git archive` → VM build, so `null` (→ the `dev` marker,
 * see `formatBuildVersion`) is exactly the safe default everywhere else.
 */
export function parseVersionFileContents(contents: string | undefined): ParsedBuildVersion | null {
  if (!contents) {
    return null;
  }
  const match = VERSION_LINE_RE.exec(contents.trim());
  if (!match) {
    return null;
  }
  return { sha: match[1], date: match[2] };
}

/** Formats a parsed version for display, e.g. `994831b · 2026-08-14`, or the
 * `dev` marker when `parsed` is `null` (see `parseVersionFileContents`). */
export function formatBuildVersion(parsed: ParsedBuildVersion | null): string {
  return parsed ? `${parsed.sha} · ${parsed.date}` : 'dev';
}

/**
 * Resolves the build-time version string for the `__BUILD_VERSION__` Vite
 * `define` constant (see `vite.config.ts`) from the repo-root `VERSION`
 * file at `versionFilePath`. Runs once, in Node, when Vite evaluates the
 * config (`vite build` / `vite dev` startup) — never at runtime in the
 * browser (EVT-34 AC2).
 */
export function resolveBuildVersion(versionFilePath: string): string {
  return formatBuildVersion(parseVersionFileContents(readVersionFile(versionFilePath)));
}
