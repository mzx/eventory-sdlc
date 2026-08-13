// ECIA 2D label parser (EVT-31).
//
// DigiKey/Mouser/LCSC (and most electronics distributors) print a Data
// Matrix or PDF417 code on their pick labels encoding a handful of ANSI
// MH10.8.2 "data identifier" (DI) fields inside an ISO/IEC 15434 envelope:
//
//   [)>␞06␝P<customer part>␝1P<MPN>␝Q<qty>␝1T<lot>␝9D<date code>␝␞␄
//
// `␞` is RS (0x1E, Record Separator), `␝` is GS (0x1D, Group/field
// Separator), `␄` is EOT (0x04). Not every label carries the full envelope
// (some printers omit the "[)>06" header and just GS-delimit the fields),
// and not every label carries every field — this parser degrades
// gracefully in both cases rather than rejecting the scan (task risk:
// "the parser must degrade to raw scan text in a field, user fills the
// rest rather than rejecting the scan").
//
// Only the four fields this task's acceptance criteria call out are
// extracted: `P` (customer/supplier part number), `1P` (manufacturer part
// number / MPN), `Q` (quantity), `1T` (lot/batch code), `9D` (date code).
// Every other DI (customer PO, CAGE code, country of origin, ...) is
// simply ignored — this is intentionally NOT a general-purpose MH10.8.2
// decoder (non-goal: "1D barcode receiving or arbitrary-format guessing").

/** Group Separator — delimits fields inside the ISO/IEC 15434 envelope. */
const GS = '\x1D';
/** Record Separator — opens/closes the envelope alongside `EOT`. */
const RS = '\x1E';
/** End Of Transmission — closes the envelope. */
const EOT = '\x04';

/** The subset of ECIA/MH10.8.2 fields this task cares about. */
export interface EciaFields {
  /** `1P` — manufacturer part number. */
  mpn?: string;
  /** `P` — customer/supplier reference part number. */
  supplierPn?: string;
  /** `Q` — quantity, parsed as an integer. */
  quantity?: number;
  /** `1T` — lot/batch (traceability) code. */
  lot?: string;
  /** `9D` — date code. */
  dateCode?: string;
}

export interface ParsedEciaBarcode extends EciaFields {
  /**
   * The raw decoded scan text, verbatim, always present — so a partially or
   * wholly unrecognized label still gives the intake form something to show
   * (and the user something to edit) rather than a dead end.
   */
  raw: string;
}

/**
 * Data identifiers this parser recognizes, longest-prefix-first so a
 * two-character DI (`1P`, `9D`, `1T`) is never mistaken for a one-character
 * one starting with the same leading digit sequence. In practice the DIs
 * below don't actually collide as literal prefixes of one another (a field
 * starting with `1P...` never also starts with `P...`), but ordering
 * longest-first keeps this safe against future additions.
 */
const FIELD_IDENTIFIERS: Array<{ di: string; key: keyof EciaFields }> = [
  { di: '1P', key: 'mpn' },
  { di: '9D', key: 'dateCode' },
  { di: '1T', key: 'lot' },
  { di: 'Q', key: 'quantity' },
  { di: 'P', key: 'supplierPn' },
];

/**
 * Parses a decoded Data Matrix / PDF417 scan into whichever ECIA fields it
 * carries. Never throws — a scan with no recognizable ECIA structure at all
 * (no `[)>` envelope header AND no GS-delimited fields) returns just
 * `{ raw }`, so the caller can fall back to "raw scan text in a field, user
 * fills the rest" (AC 2) instead of erroring out.
 */
export function parseEciaBarcode(text: string): ParsedEciaBarcode {
  const result: ParsedEciaBarcode = { raw: text };

  const hasEnvelopeHeader = text.startsWith('[)>');
  const body = stripEnvelope(text);

  if (!hasEnvelopeHeader && !body.includes(GS)) {
    // Nothing that looks like ECIA structure — don't guess (non-goal:
    // "arbitrary-format guessing"). Leave every field undefined; the raw
    // text is still returned above.
    return result;
  }

  for (const field of splitFields(body)) {
    const match = matchField(field);
    if (!match) {
      continue;
    }
    const { key, value } = match;
    if (key === 'quantity') {
      // Narrowed off the string-keyed branch below so `result[key] = value`
      // there type-checks as a string assignment, not `string | number`.
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        result.quantity = parsed;
      }
    } else if (value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

/** Strips the ISO/IEC 15434 envelope header/trailer, if present. */
function stripEnvelope(text: string): string {
  let body = text;
  // Header: "[)>" + RS + 2-digit format id (e.g. "06") + GS — each of RS/GS
  // is optional in the match since some encoders omit the control chars
  // themselves while keeping the literal "[)>06" text.
  const header = body.match(new RegExp(`^\\[\\)>${RS}?\\d{2}${GS}?`));
  if (header) {
    body = body.slice(header[0].length);
  }
  // Trailer: RS + EOT, optionally preceded by a trailing GS field separator.
  body = body.replace(new RegExp(`${GS}?${RS}${EOT}$`), '');
  return body;
}

/** Splits the envelope body into individual DI+value fields. */
function splitFields(body: string): string[] {
  if (body.includes(GS)) {
    return body
      .split(GS)
      .map((field) => field.trim())
      .filter((field) => field.length > 0);
  }
  // No GS present but we got here because an envelope header WAS matched —
  // treat the remainder as a single field so a lone leading DI is still
  // recognized.
  const trimmed = body.trim();
  return trimmed.length > 0 ? [trimmed] : [];
}

/** Matches a single field's leading DI against `FIELD_IDENTIFIERS`. */
function matchField(field: string): { key: keyof EciaFields; value: string } | null {
  for (const { di, key } of FIELD_IDENTIFIERS) {
    if (field.startsWith(di)) {
      return { key, value: field.slice(di.length).trim() };
    }
  }
  return null;
}
