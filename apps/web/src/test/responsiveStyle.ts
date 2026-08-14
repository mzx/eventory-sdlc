/**
 * MUI `sx` responsive breakpoint values (e.g. `{ xs: 'none', sm: 'flex' }`)
 * are emitted as separate `@media (min-width:Npx){ .css-hash{...} }` rules
 * rather than a single unconditional declaration jsdom's `getComputedStyle`
 * can see. jsdom does not evaluate `@media` at all — `toHaveStyle` silently
 * no-ops against ANY responsive `sx` value (both the `xs` and `sm` blocks
 * come back as if unset), which is why a test built on `toHaveStyle` alone
 * would keep passing even if a breakpoint toggle were deleted or broken
 * (EVT-37 review round 2, finding #2/#4).
 *
 * This reads the actual emitted CSS declaration for a given element's
 * hashed emotion class + `min-width` breakpoint straight out of the
 * `<style>` tags emotion inserts into `document.head`, so a regression that
 * removes or breaks a breakpoint's rule fails the assertion.
 */
export function responsiveDeclaration(
  element: Element,
  property: string,
  minWidthPx: number,
): string | undefined {
  const hashClass = element.className.split(' ').find((cls) => cls.startsWith('css-'));
  if (!hashClass) return undefined;

  const escapedClass = hashClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const css = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');

  const blockPattern = new RegExp(
    `@media \\(min-width:${minWidthPx}px\\)\\{\\.${escapedClass}\\{([^}]*)\\}`,
  );
  const block = blockPattern.exec(css)?.[1];
  if (!block) return undefined;

  // A property can appear more than once inside a block (vendor-prefixed
  // fallbacks emitted ahead of the standard property, e.g. `display`) —
  // later declarations win in CSS cascade order, so take the last match.
  const propertyMatches = [...block.matchAll(new RegExp(`(?:^|;)${property}:([^;]+)`, 'g'))];
  return propertyMatches.at(-1)?.[1];
}
