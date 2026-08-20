import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { UpdateUserStatusDto } from './update-user-status.dto';

/**
 * Proves the class-validator wiring against the exact `ValidationPipe`
 * config `main.ts` installs globally — same pattern as
 * `workspace/workspaces.dto.spec.ts`. The headline regression this guards
 * (EVT-42 round-2 security review, MAJOR): `pending` must be REJECTED here,
 * not silently accepted as a no-op admin action — see the DTO's doc
 * comment.
 */
describe('UpdateUserStatusDto validation (ValidationPipe, matches main.ts config)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
  const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateUserStatusDto, data: '' };

  it('accepts status: "approved"', async () => {
    const result = await pipe.transform({ status: 'approved' }, metadata);
    expect(result).toBeInstanceOf(UpdateUserStatusDto);
    expect(result.status).toBe('approved');
  });

  it('accepts status: "rejected"', async () => {
    const result = await pipe.transform({ status: 'rejected' }, metadata);
    expect(result.status).toBe('rejected');
  });

  it('REJECTS status: "pending" — an inert legacy status, not a settable admin action', async () => {
    await expect(pipe.transform({ status: 'pending' }, metadata)).rejects.toThrow();
  });

  it('rejects an unknown status string', async () => {
    await expect(pipe.transform({ status: 'banned' }, metadata)).rejects.toThrow();
  });

  it('rejects a missing status', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
  });
});
