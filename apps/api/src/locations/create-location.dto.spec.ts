import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CreateLocationDto } from './create-location.dto';

/**
 * Proves the class-validator wiring on `CreateLocationDto.kind` (EVT-30
 * review round 3, TEST-COVERAGE finding) — not merely that the `@IsEnum`
 * decorator is present on the class, but that the exact `ValidationPipe`
 * config `main.ts` installs globally actually rejects an invalid `kind`
 * with a 400-triggering error, rather than letting it fall through to
 * Prisma as a raw 500 from the Postgres enum constraint (the bug this DTO
 * was converted from a plain interface to fix — see the class's doc
 * comment). Follows the same pattern as
 * `stock-movements/list-movements-query.dto.spec.ts`.
 */
describe('CreateLocationDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateLocationDto, data: '' };

  it('accepts a valid area payload (kind omitted, defaults applied by Prisma)', async () => {
    const result = await pipe.transform({ name: 'Garage' }, metadata);
    expect(result).toBeInstanceOf(CreateLocationDto);
    expect(result.kind).toBeUndefined();
  });

  it('accepts kind: "area"', async () => {
    const result = await pipe.transform({ name: 'Garage', kind: 'area' }, metadata);
    expect(result.kind).toBe('area');
  });

  it('accepts kind: "container"', async () => {
    const result = await pipe.transform({ name: 'Red toolbox', kind: 'container' }, metadata);
    expect(result.kind).toBe('container');
  });

  // The headline regression: an invalid kind must be rejected HERE, by the
  // real ValidationPipe, before it ever reaches Prisma.
  it('rejects an invalid kind (e.g. "box") with a validation error', async () => {
    await expect(pipe.transform({ name: 'Mystery box', kind: 'box' }, metadata)).rejects.toThrow();
  });

  it('rejects a numeric kind', async () => {
    await expect(pipe.transform({ name: 'X', kind: 1 }, metadata)).rejects.toThrow();
  });

  it('rejects an empty-string kind', async () => {
    await expect(pipe.transform({ name: 'X', kind: '' }, metadata)).rejects.toThrow();
  });

  it('still rejects a missing name regardless of kind validity', async () => {
    await expect(pipe.transform({ kind: 'container' }, metadata)).rejects.toThrow();
  });
});
