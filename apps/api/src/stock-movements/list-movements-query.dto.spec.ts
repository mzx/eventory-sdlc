import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ListMovementsQueryDto } from './list-movements-query.dto';

/**
 * Runs the exact `ValidationPipe` config main.ts installs globally
 * (`transform: true`, no `enableImplicitConversion`) — `@Type(() =>
 * Number)` on `page`/`pageSize` is what makes a query string like `?page=2`
 * coerce to a number here; without it `@IsInt()` would reject the raw
 * string (EVT-25 AC 5).
 */
describe('ListMovementsQueryDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'query', metatype: ListMovementsQueryDto, data: '' };

  it('coerces a query-string page/pageSize into numbers', async () => {
    const result = await pipe.transform({ page: '2', pageSize: '10' }, metadata);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('accepts an empty query (both omitted)', async () => {
    const result = await pipe.transform({}, metadata);
    expect(result.page).toBeUndefined();
    expect(result.pageSize).toBeUndefined();
  });

  it('rejects page < 1', async () => {
    await expect(pipe.transform({ page: '0' }, metadata)).rejects.toThrow();
  });

  it('rejects pageSize < 1', async () => {
    await expect(pipe.transform({ pageSize: '0' }, metadata)).rejects.toThrow();
  });

  it('rejects pageSize > 100', async () => {
    await expect(pipe.transform({ pageSize: '101' }, metadata)).rejects.toThrow();
  });

  it('accepts pageSize at the boundary (100)', async () => {
    const result = await pipe.transform({ pageSize: '100' }, metadata);
    expect(result.pageSize).toBe(100);
  });

  it('rejects a non-numeric page', async () => {
    await expect(pipe.transform({ page: 'not-a-number' }, metadata)).rejects.toThrow();
  });
});
