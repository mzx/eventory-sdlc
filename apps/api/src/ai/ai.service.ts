import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured draft an item's photo produces. This is a DRAFT for the intake
 * form — nothing downstream auto-creates an `Item` from it.
 *
 * `properties` holds only attributes the model is CONFIDENT about (brand,
 * size, voltage, ...); anything uncertain (approximate specs, guessed model
 * numbers) belongs in `search_keywords`, never asserted as fact here.
 */
export interface AiAnalysisResult {
  suggested_name: string;
  description: string;
  tags: string[];
  color: string | null;
  quantity: number | null;
  unit: string | null;
  properties: Record<string, unknown>;
  search_keywords: string[];
  /**
   * Present only when this result is a stub returned *without* a model call
   * being attempted (as opposed to a stub returned after a call failed,
   * refused, or produced unparsable JSON) — lets callers distinguish "we
   * didn't even try" from "the model came back with nothing useful". See
   * {@link StubReason} for the enumerated causes (EVT-7 review round 2,
   * findings 2 & 3).
   */
  stub_reason?: StubReason;
}

/** Enumerated reasons {@link AiAnalysisResult.stub_reason} may carry. */
export type StubReason = 'unsupported-image-format' | 'oversized';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2048;

/**
 * MIME types Anthropic's base64 image content block accepts (per the
 * `@anthropic-ai/sdk` `Base64ImageSource['media_type']` union — jpeg, png,
 * gif, webp only). Deliberately narrower than `ALLOWED_PHOTO_MIME_TYPES` in
 * `photos.service.ts` (which also accepts `image/heic` / `image/heif` for
 * *storage*): an unconverted iPhone HEIC/HEIF photo previously hit the
 * unchecked `media_type as ...` cast and silently degraded to the generic
 * stub via the catch-all error path, indistinguishable from "the model
 * couldn't identify the item" (EVT-7 review round 2, finding 2).
 */
const SUPPORTED_VISION_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Narrows `mimeType` to Anthropic's accepted media-type union. */
function isSupportedVisionMimeType(
  mimeType: string,
): mimeType is Anthropic.Base64ImageSource['media_type'] {
  return SUPPORTED_VISION_MIME_TYPES.has(mimeType);
}

/**
 * Deterministic fallback shape — used when no API key is configured, the
 * model refuses, the call fails, or the response can't be parsed as the
 * expected JSON. Keeps the app fully usable offline (PRODUCT.md §2).
 */
export const STUB_ANALYSIS: AiAnalysisResult = {
  suggested_name: 'Unknown item',
  description: '',
  tags: [],
  color: null,
  quantity: null,
  unit: null,
  properties: {},
  search_keywords: [],
};

/**
 * Returns a fresh deep copy of {@link STUB_ANALYSIS}. `STUB_ANALYSIS`
 * itself must never be handed out directly — its `tags`/`properties`/
 * `search_keywords` are reference types, and callers (e.g. the intake form)
 * treat the result as their own mutable draft.
 *
 * `reason`, when supplied, is stamped onto `stub_reason` — used for the
 * "we deliberately skipped the model call" cases (unsupported mimetype,
 * oversized file) as opposed to the plain no-key/refusal/malformed-JSON
 * stub paths, which stay bare for backwards compatibility with existing
 * callers that `toEqual(STUB_ANALYSIS)`.
 */
export function stubAnalysis(reason?: StubReason): AiAnalysisResult {
  return {
    ...STUB_ANALYSIS,
    tags: [...STUB_ANALYSIS.tags],
    properties: { ...STUB_ANALYSIS.properties },
    search_keywords: [...STUB_ANALYSIS.search_keywords],
    ...(reason && { stub_reason: reason }),
  };
}

export const SYSTEM_PROMPT = `You are a workshop/household inventory assistant. You are shown a single photo of an item that a user wants to catalog.

Identify the item and respond with ONLY a JSON object (no markdown code fences, no other text) with exactly this shape:

{
  "suggested_name": string,
  "description": string,
  "tags": string[],
  "color": string,
  "quantity": number,
  "unit": string,
  "properties": { [key: string]: string | number | boolean },
  "search_keywords": string[]
}

Rules:
- "properties" must contain ONLY concrete attributes you are CONFIDENT about from what is visible or legible in the photo (e.g. brand, size, voltage, model number printed on a label).
- Anything you are uncertain about — approximate specs, guessed model numbers, ambiguous measurements (e.g. "M4 vs M5", "18V vs 20V") — must go into "search_keywords" as free-text search terms. Never state an uncertain attribute as fact in "properties" or "description".
- Return ONLY the JSON object described above. No prose, no markdown code fences, no explanation before or after it.`;

// ---------------------------------------------------------------------------
// AiService
// ---------------------------------------------------------------------------

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /**
   * Lazily constructed and cached. Must NOT be built in the constructor —
   * `new Anthropic()` throws when no `apiKey` is supplied and no
   * `ANTHROPIC_API_KEY` env var exists, which would crash app boot whenever
   * `EVENTORY_ANTHROPIC_KEY` is absent (AC 3: app boots cleanly without a
   * key).
   */
  private client: Anthropic | undefined;

  /**
   * The `apiKey` the cached {@link client} was built with. `EVENTORY_ANTHROPIC_KEY`
   * is read fresh on every call (see {@link apiKey}), so if it changes at
   * runtime (e.g. a secrets-manager rotation without a process restart) the
   * client must be rebuilt rather than silently keep using the stale key
   * (EVT-7 review round 2, finding 4).
   */
  private cachedApiKey: string | undefined;

  private get apiKey(): string | undefined {
    return process.env.EVENTORY_ANTHROPIC_KEY;
  }

  private get model(): string {
    return process.env.EVENTORY_ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  private getClient(apiKey: string): Anthropic {
    if (!this.client || this.cachedApiKey !== apiKey) {
      this.client = new Anthropic({ apiKey });
      this.cachedApiKey = apiKey;
    }
    return this.client;
  }

  /**
   * Analyzes a photo and returns a structured draft (see {@link AiAnalysisResult}).
   *
   * Never throws: any failure — no key configured, network/API error, model
   * refusal, or an unparsable response — degrades to {@link STUB_ANALYSIS}
   * so a flaky/absent AI provider never blocks the upload flow.
   */
  async analyzePhoto(buffer: Buffer, mimeType: string): Promise<AiAnalysisResult> {
    if (!isSupportedVisionMimeType(mimeType)) {
      this.logger.log(
        `${mimeType} is not a vision-supported MIME type (jpeg/png/gif/webp only) — skipping Claude call, returning stub analysis`,
      );
      return stubAnalysis('unsupported-image-format');
    }

    const apiKey = this.apiKey;
    if (!apiKey) {
      this.logger.log('EVENTORY_ANTHROPIC_KEY not configured — returning stub analysis');
      return stubAnalysis();
    }

    try {
      const client = this.getClient(apiKey);
      const response = await client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: buffer.toString('base64'),
                },
              },
              {
                type: 'text',
                text: 'Analyze this item photo and return the JSON object described in the system prompt.',
              },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        this.logger.warn('Claude vision analysis was refused — returning stub analysis');
        return stubAnalysis();
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return this.parseAnalysis(text);
    } catch (err) {
      this.logger.warn(
        `Claude vision analysis failed (${(err as Error).message}) — returning stub analysis`,
      );
      return stubAnalysis();
    }
  }

  /**
   * Parses the model's response defensively: strips markdown code fences,
   * tolerates missing/wrong-typed fields by falling back to
   * {@link STUB_ANALYSIS} defaults per-field, and falls back to the full
   * stub shape on outright unparsable JSON.
   */
  private parseAnalysis(text: string): AiAnalysisResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      this.logger.warn('Claude vision response was not valid JSON — returning stub analysis');
      return stubAnalysis();
    }
    return normalizeAnalysis(parsed);
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Strips a single leading/trailing markdown code fence (```` ``` ```` or
 * ```` ```json ````) around the response text, if present. Models
 * occasionally wrap JSON in fences despite being told not to.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Coerces a parsed-but-untrusted JSON value into a well-formed
 * {@link AiAnalysisResult}, field by field — a missing or wrong-typed field
 * falls back to the corresponding {@link STUB_ANALYSIS} default rather than
 * rejecting the whole response.
 */
export function normalizeAnalysis(parsed: unknown): AiAnalysisResult {
  if (typeof parsed !== 'object' || parsed === null) {
    return stubAnalysis();
  }
  const p = parsed as Record<string, unknown>;
  return {
    suggested_name:
      typeof p.suggested_name === 'string' ? p.suggested_name : STUB_ANALYSIS.suggested_name,
    description: typeof p.description === 'string' ? p.description : STUB_ANALYSIS.description,
    tags: isStringArray(p.tags) ? p.tags : [],
    color: typeof p.color === 'string' ? p.color : null,
    quantity: typeof p.quantity === 'number' && Number.isFinite(p.quantity) ? p.quantity : null,
    unit: typeof p.unit === 'string' ? p.unit : null,
    properties: isPlainObject(p.properties) ? p.properties : {},
    search_keywords: isStringArray(p.search_keywords) ? p.search_keywords : [],
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
