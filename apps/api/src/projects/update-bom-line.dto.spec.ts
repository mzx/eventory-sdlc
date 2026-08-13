import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { UpdateBomLineDto } from './update-bom-line.dto';

/**
 * Round-2 review finding: `itemId` only accepted `@IsUUID()`, so a linked
 * BOM line could never be unlinked via PATCH even though the schema
 * supports a nullable `itemId`. `@IsOptional()` treats `null` the same as
 * `undefined` (skips subsequent validators for that property), so no extra
 * `@ValidateIf` is needed — these tests prove that end-to-end through the
 * same `ValidationPipe` config main.ts installs globally.
 */
describe('UpdateBomLineDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateBomLineDto, data: '' };

  it('accepts itemId: null (unlinks the line)', async () => {
    const result = await pipe.transform({ itemId: null }, metadata);
    expect(result.itemId).toBeNull();
  });

  it('still accepts a valid UUID for itemId (re-link)', async () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const result = await pipe.transform({ itemId: uuid }, metadata);
    expect(result.itemId).toBe(uuid);
  });

  it('still rejects a non-UUID, non-null itemId', async () => {
    await expect(pipe.transform({ itemId: 'not-a-uuid' }, metadata)).rejects.toThrow();
  });

  it('accepts a body that omits itemId entirely (untouched)', async () => {
    const result = await pipe.transform({ quantity: 6 }, metadata);
    expect(result.quantity).toBe(6);
    expect(result.itemId).toBeUndefined();
  });

  // ── picked — kitting pick-list check-off state (EVT-29 AC 3) ────────────

  it('accepts picked: true', async () => {
    const result = await pipe.transform({ picked: true }, metadata);
    expect(result.picked).toBe(true);
  });

  it('accepts picked: false', async () => {
    const result = await pipe.transform({ picked: false }, metadata);
    expect(result.picked).toBe(false);
  });

  it('rejects a non-boolean picked value', async () => {
    await expect(pipe.transform({ picked: 'yes' }, metadata)).rejects.toThrow();
  });
});
