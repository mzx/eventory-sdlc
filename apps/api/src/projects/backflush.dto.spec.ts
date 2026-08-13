import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { BackflushDto } from './backflush.dto';

/**
 * Review round 2, finding 7: `BackflushDto`/`BackflushLineDto` had no
 * `ValidationPipe` spec (module convention — see
 * `update-bom-line.dto.spec.ts`), so the `@ArrayMaxSize` guard added for
 * finding 3 (and the existing nested `BackflushLineDto` validation) had no
 * end-to-end proof it actually runs through the same `ValidationPipe` config
 * `main.ts` installs globally.
 */
describe('BackflushDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'body', metatype: BackflushDto, data: '' };

  const validLineId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts a well-formed body with lines and no confirmAgain', async () => {
    const result = await pipe.transform(
      { lines: [{ lineId: validLineId, consumeQuantity: 2 }] },
      metadata,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].lineId).toBe(validLineId);
    expect(result.lines[0].consumeQuantity).toBe(2);
    expect(result.confirmAgain).toBeUndefined();
  });

  it('accepts an empty lines array (an all-free-text-BOM project has nothing to consume)', async () => {
    const result = await pipe.transform({ lines: [] }, metadata);
    expect(result.lines).toEqual([]);
  });

  it('accepts confirmAgain: true', async () => {
    const result = await pipe.transform(
      { lines: [{ lineId: validLineId, consumeQuantity: 1 }], confirmAgain: true },
      metadata,
    );
    expect(result.confirmAgain).toBe(true);
  });

  it('rejects a body with lines missing entirely', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
  });

  it('rejects a non-array lines value', async () => {
    await expect(pipe.transform({ lines: 'not-an-array' }, metadata)).rejects.toThrow();
  });

  it('rejects a line entry with a non-UUID lineId (nested validation)', async () => {
    await expect(
      pipe.transform({ lines: [{ lineId: 'not-a-uuid', consumeQuantity: 1 }] }, metadata),
    ).rejects.toThrow();
  });

  it('rejects a line entry with a negative consumeQuantity (nested validation)', async () => {
    await expect(
      pipe.transform({ lines: [{ lineId: validLineId, consumeQuantity: -1 }] }, metadata),
    ).rejects.toThrow();
  });

  it('review round 2, finding 3/7: rejects a lines array over the 200-entry ArrayMaxSize cap', async () => {
    const lines = Array.from({ length: 201 }, () => ({ lineId: validLineId, consumeQuantity: 1 }));
    await expect(pipe.transform({ lines }, metadata)).rejects.toThrow();
  });

  it('accepts a lines array right at the 200-entry cap', async () => {
    const lines = Array.from({ length: 200 }, () => ({ lineId: validLineId, consumeQuantity: 1 }));
    const result = await pipe.transform({ lines }, metadata);
    expect(result.lines).toHaveLength(200);
  });
});
