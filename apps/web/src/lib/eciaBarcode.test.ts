import { describe, expect, it } from 'vitest';
import { parseEciaBarcode } from './eciaBarcode';

const RS = '\x1E';
const GS = '\x1D';
const EOT = '\x04';

/** Builds a full ISO/IEC 15434-enveloped ECIA scan from GS-delimited fields. */
function envelope(...fields: string[]): string {
  return `[)>${RS}06${GS}${fields.join(GS)}${GS}${RS}${EOT}`;
}

describe('parseEciaBarcode', () => {
  // ---------------------------------------------------------------------------
  // AC 1 — a full DigiKey-style vector decodes MPN, quantity, and lot (plus
  // the supplier/customer part number and date code this parser also
  // extracts).
  // ---------------------------------------------------------------------------
  it('AC1: parses a full ECIA vector into every recognized field', () => {
    const raw = envelope('P296-1234-1-ND', '1PRC0402FR-071KL', 'Q100', '1TWK2312', '9D231106');

    const result = parseEciaBarcode(raw);

    expect(result).toEqual({
      raw,
      supplierPn: '296-1234-1-ND',
      mpn: 'RC0402FR-071KL',
      quantity: 100,
      lot: 'WK2312',
      dateCode: '231106',
    });
  });

  it('works without the "[)>06" envelope header when fields are still GS-delimited', () => {
    const raw = `1PRC0402FR-071KL${GS}Q100`;

    const result = parseEciaBarcode(raw);

    expect(result.mpn).toBe('RC0402FR-071KL');
    expect(result.quantity).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // AC 2 — partial labels: missing identifiers leave the rest editable
  // (i.e. simply undefined), no error, no dead end.
  // ---------------------------------------------------------------------------
  it('AC2: a partial vector (MPN + quantity only) leaves the missing fields undefined', () => {
    const raw = envelope('1PRC0402FR-071KL', 'Q25');

    const result = parseEciaBarcode(raw);

    expect(result.mpn).toBe('RC0402FR-071KL');
    expect(result.quantity).toBe(25);
    expect(result.supplierPn).toBeUndefined();
    expect(result.lot).toBeUndefined();
    expect(result.dateCode).toBeUndefined();
    expect(result.raw).toBe(raw);
  });

  it('AC2: a label with only a customer part number and lot leaves MPN/quantity/date undefined', () => {
    const raw = envelope('P296-1234-1-ND', '1TWK2312');

    const result = parseEciaBarcode(raw);

    expect(result.supplierPn).toBe('296-1234-1-ND');
    expect(result.lot).toBe('WK2312');
    expect(result.mpn).toBeUndefined();
    expect(result.quantity).toBeUndefined();
    expect(result.dateCode).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Malformed / unrecognized vectors degrade to raw text only — never throw,
  // never fabricate fields (non-goal: no arbitrary-format guessing).
  // ---------------------------------------------------------------------------
  it('degrades to raw-only for plain text with no ECIA structure at all', () => {
    const raw = 'HELLO WORLD 12345 NOT A BARCODE';

    const result = parseEciaBarcode(raw);

    expect(result).toEqual({ raw });
  });

  it('degrades to raw-only for an empty string', () => {
    expect(parseEciaBarcode('')).toEqual({ raw: '' });
  });

  it('ignores unrecognized data identifiers inside an otherwise valid envelope', () => {
    const raw = envelope('K4500123', '1PRC0402FR-071KL', '30PCN');

    const result = parseEciaBarcode(raw);

    expect(result.mpn).toBe('RC0402FR-071KL');
    // `K` (customer PO) and `30P` (country of origin) are not among the
    // fields this parser extracts — they're silently ignored rather than
    // corrupting `supplierPn`/`mpn`.
    expect(result.supplierPn).toBeUndefined();
  });

  it('ignores a non-numeric quantity field rather than throwing', () => {
    const raw = envelope('1PRC0402FR-071KL', 'QMANY');

    const result = parseEciaBarcode(raw);

    expect(result.mpn).toBe('RC0402FR-071KL');
    expect(result.quantity).toBeUndefined();
  });

  it('distinguishes the "1P" (MPN) field from the bare "P" (supplier PN) field', () => {
    const raw = envelope('P296-1234-1-ND', '1PRC0402FR-071KL');

    const result = parseEciaBarcode(raw);

    expect(result.supplierPn).toBe('296-1234-1-ND');
    expect(result.mpn).toBe('RC0402FR-071KL');
  });
});
