import { Test, TestingModule } from '@nestjs/testing';
import { AiService, STUB_ANALYSIS } from './ai.service';

// ---------------------------------------------------------------------------
// @anthropic-ai/sdk mock — verify AiService never constructs a client when
// no key is configured (AC 3), and drive `messages.create` responses.
//
// The factory below references ONLY identifiers declared inside itself
// (never outer-scope test-file variables) — ts-jest hoists `jest.mock()`
// calls above other module-level statements (including the `import
// { AiService } from './ai.service'` above, which itself imports this
// package), so any outer-scope reference here would hit a TDZ
// ReferenceError. `createMock`/`anthropicConstructorMock` are recovered
// afterwards via `jest.requireMock`, which is safe to call at any point.
// ---------------------------------------------------------------------------

jest.mock('@anthropic-ai/sdk', () => {
  const createMock = jest.fn();
  // A plain function (not an arrow function) so it can be invoked with
  // `new Anthropic(...)` in the service under test; explicitly returning an
  // object from the implementation makes that object the `new` result.
  const ctor = jest.fn(() => ({ messages: { create: createMock } }));
  return { __esModule: true, default: ctor, __createMock: createMock };
});

const { default: anthropicConstructorMock, __createMock: createMock } = jest.requireMock(
  '@anthropic-ai/sdk',
) as { default: jest.Mock; __createMock: jest.Mock };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResponse(text: string, stopReason: string | null = 'end_turn') {
  return { content: [{ type: 'text', text }], stop_reason: stopReason };
}

const FAKE_BUFFER = Buffer.from('fake-image-bytes');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiService', () => {
  let service: AiService;
  const originalKey = process.env.EVENTORY_ANTHROPIC_KEY;
  const originalModel = process.env.EVENTORY_ANTHROPIC_MODEL;

  beforeEach(async () => {
    createMock.mockReset();
    anthropicConstructorMock.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.EVENTORY_ANTHROPIC_KEY;
    } else {
      process.env.EVENTORY_ANTHROPIC_KEY = originalKey;
    }
    if (originalModel === undefined) {
      delete process.env.EVENTORY_ANTHROPIC_MODEL;
    } else {
      process.env.EVENTORY_ANTHROPIC_MODEL = originalModel;
    }
  });

  // =========================================================================
  // No key configured (AC 3)
  // =========================================================================

  describe('no key configured', () => {
    it('returns the stub analysis without constructing an Anthropic client', async () => {
      delete process.env.EVENTORY_ANTHROPIC_KEY;

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(STUB_ANALYSIS);
      expect(anthropicConstructorMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });

    it('returns a fresh copy each call (not a shared mutable reference)', async () => {
      delete process.env.EVENTORY_ANTHROPIC_KEY;

      const first = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');
      first.tags.push('mutated');

      const second = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(second.tags).toEqual([]);
    });
  });

  // =========================================================================
  // Happy path
  // =========================================================================

  describe('happy path', () => {
    it('parses a well-formed JSON response', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      const draft = {
        suggested_name: 'Cordless Drill',
        description: 'A yellow cordless drill',
        tags: ['power-tools', 'drill'],
        color: 'yellow',
        quantity: 1,
        unit: 'each',
        properties: { brand: 'DeWalt' },
        search_keywords: ['18V or 20V', 'model number unclear'],
      };
      createMock.mockResolvedValue(textResponse(JSON.stringify(draft)));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(draft);
    });

    it('constructs the client only once per key, lazily on first analysis', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('{}'));

      expect(anthropicConstructorMock).not.toHaveBeenCalled();
      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');
      expect(anthropicConstructorMock).toHaveBeenCalledTimes(1);
      expect(anthropicConstructorMock).toHaveBeenCalledWith({ apiKey: 'test-key' });

      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');
      expect(anthropicConstructorMock).toHaveBeenCalledTimes(1);
    });

    it('uses EVENTORY_ANTHROPIC_MODEL when set, else defaults to claude-sonnet-5', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('{}'));

      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-5' }),
      );

      createMock.mockClear();
      process.env.EVENTORY_ANTHROPIC_MODEL = 'claude-custom-model';
      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-custom-model' }),
      );
    });

    it('sends the image as a base64 content block alongside the system prompt', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('{}'));

      await service.analyzePhoto(FAKE_BUFFER, 'image/png');

      const call = createMock.mock.calls[0][0];
      expect(call.messages[0].content[0]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: FAKE_BUFFER.toString('base64') },
      });
    });
  });

  // =========================================================================
  // Fenced JSON response (AC 1)
  // =========================================================================

  describe('fenced JSON response', () => {
    it('strips a ```json fence before parsing', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      const draft = { suggested_name: 'Hammer', description: '', tags: [], color: null };
      createMock.mockResolvedValue(textResponse('```json\n' + JSON.stringify(draft) + '\n```'));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result.suggested_name).toBe('Hammer');
    });

    it('strips a plain ``` fence (no language tag) before parsing', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('```\n{"suggested_name":"Wrench"}\n```'));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result.suggested_name).toBe('Wrench');
    });
  });

  // =========================================================================
  // Malformed → stub fallback (AC 1)
  // =========================================================================

  describe('malformed response → stub fallback', () => {
    it('falls back to the stub when the response is not valid JSON', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('Sorry, I cannot identify this item.'));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(STUB_ANALYSIS);
    });

    it('coerces wrong-typed / missing fields to defaults instead of throwing', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(
        textResponse(
          JSON.stringify({ suggested_name: 42, tags: 'not-an-array', properties: 'nope' }),
        ),
      );

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(STUB_ANALYSIS);
    });

    it('falls back to the stub when the model refuses', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('', 'refusal'));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(STUB_ANALYSIS);
    });

    it('falls back to the stub when the API call throws', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockRejectedValue(new Error('network error'));

      const result = await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      expect(result).toEqual(STUB_ANALYSIS);
    });
  });

  // =========================================================================
  // Prompt caching (AC 4)
  // =========================================================================

  describe('prompt caching', () => {
    it('marks the system prompt block with cache_control: ephemeral', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('{}'));

      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      const call = createMock.mock.calls[0][0];
      expect(call.system).toEqual([
        expect.objectContaining({
          type: 'text',
          cache_control: { type: 'ephemeral' },
        }),
      ]);
    });

    it('does not set temperature/top_p (rejected on current models)', async () => {
      process.env.EVENTORY_ANTHROPIC_KEY = 'test-key';
      createMock.mockResolvedValue(textResponse('{}'));

      await service.analyzePhoto(FAKE_BUFFER, 'image/jpeg');

      const call = createMock.mock.calls[0][0];
      expect(call).not.toHaveProperty('temperature');
      expect(call).not.toHaveProperty('top_p');
    });
  });
});
