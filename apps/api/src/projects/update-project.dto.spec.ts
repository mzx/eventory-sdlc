import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { UpdateProjectDto } from './update-project.dto';

/**
 * Round-2 review finding: `@IsDateString()` on `startedAt`/`completedAt`
 * rejected an empty string (the documented "clear this field" signal)
 * BEFORE ProjectsService.update() ever got a chance to convert `''` to
 * `null`. These tests run the exact `ValidationPipe` config main.ts
 * installs globally, so a regression here reproduces the real 400.
 */
describe('UpdateProjectDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateProjectDto, data: '' };

  it('accepts an empty string for startedAt (clears the field)', async () => {
    const result = await pipe.transform({ startedAt: '' }, metadata);
    expect(result.startedAt).toBe('');
  });

  it('accepts an empty string for completedAt (clears the field)', async () => {
    const result = await pipe.transform({ completedAt: '' }, metadata);
    expect(result.completedAt).toBe('');
  });

  it('accepts an empty string for both startedAt and completedAt together', async () => {
    const result = await pipe.transform({ startedAt: '', completedAt: '' }, metadata);
    expect(result.startedAt).toBe('');
    expect(result.completedAt).toBe('');
  });

  it('still accepts a valid ISO-8601 date string for startedAt', async () => {
    const result = await pipe.transform({ startedAt: '2026-02-01T00:00:00.000Z' }, metadata);
    expect(result.startedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('still rejects a non-empty, non-ISO-8601 string for startedAt', async () => {
    await expect(pipe.transform({ startedAt: 'not-a-date' }, metadata)).rejects.toThrow();
  });

  it('still rejects a non-empty, non-ISO-8601 string for completedAt', async () => {
    await expect(pipe.transform({ completedAt: 'also-not-a-date' }, metadata)).rejects.toThrow();
  });

  it('accepts a body that omits startedAt/completedAt entirely (untouched)', async () => {
    const result = await pipe.transform({ name: 'Renamed' }, metadata);
    expect(result.name).toBe('Renamed');
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });
});
