// Minimal, dependency-free extractor for a docker-compose.yml service's
// literal-block `command:` shell script (EVT-32).
//
// docker-compose.yml's `command:` blocks are YAML literal block scalars
// (`command: [sh, -c, |]`) — pulling in a full YAML parser as a new root
// dependency for one test felt disproportionate (see EVT-32 implementation
// hints: "keep complexity proportionate"), so this walks the file as plain
// text using the same two-space-per-level indentation the rest of
// docker-compose.yml already uses. It is intentionally narrow — it only
// understands the shape used by THIS file (a top-level `services:` map,
// each service a 2-space-indented key, `command:` as a 4-space-indented
// `- sh` / `- -c` / `- |` block), not YAML in general.
//
// Exported so both the test (assertions) and any future tooling can reuse
// it without re-deriving the parsing rules.

/**
 * @param {string} composeText raw contents of a docker-compose.yml file
 * @param {string} serviceName top-level key under `services:`, e.g. "api"
 * @returns {string} the dedented shell script under that service's
 *   `command: [sh, -c, |]` block
 */
export function extractServiceCommandScript(composeText, serviceName) {
  const lines = composeText.split('\n');

  const serviceHeaderRe = new RegExp(`^  ${serviceName}:\\s*$`);
  const startIdx = lines.findIndex((line) => serviceHeaderRe.test(line));
  if (startIdx === -1) {
    throw new Error(`service "${serviceName}" not found (no "  ${serviceName}:" line)`);
  }

  // The service block ends at the next line that starts a new top-level
  // service (2-space indent, non-blank) or at EOF.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  const serviceLines = lines.slice(startIdx, endIdx);

  const commandIdx = serviceLines.findIndex((line) => /^ {4}command:\s*$/.test(line));
  if (commandIdx === -1) {
    throw new Error(`service "${serviceName}" has no "command:" block`);
  }

  // Expect the `- sh` / `- -c` / `- |` list-of-args shape immediately after.
  const blockScalarIdx = serviceLines.findIndex(
    (line, i) => i > commandIdx && /^ {6}- \|\s*$/.test(line),
  );
  if (blockScalarIdx === -1) {
    throw new Error(
      `service "${serviceName}"'s "command:" is not a "- sh" / "- -c" / "- |" block scalar`,
    );
  }

  // Script body lines are indented deeper than the `- |` marker (8 spaces
  // in this file); collect until indentation returns to <= the command
  // block's own level (4 spaces) — i.e. the next sibling key.
  const scriptLines = [];
  for (let i = blockScalarIdx + 1; i < serviceLines.length; i++) {
    const line = serviceLines[i];
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    if (!/^ {8}/.test(line)) {
      break;
    }
    scriptLines.push(line.slice(8));
  }

  return scriptLines.join('\n');
}
