import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import {
  CreateInviteDto,
  CreateWorkspaceDto,
  RenameWorkspaceDto,
  UpdateMemberRoleDto,
} from './workspaces.dto';

/**
 * Proves the class-validator wiring on the workspace DTOs against the exact
 * `ValidationPipe` config `main.ts` installs globally — same pattern as
 * `locations/create-location.dto.spec.ts`. The headline regression this
 * guards is `CreateInviteDto`/`UpdateMemberRoleDto`'s role restriction:
 * `owner` must never be an acceptable value on either (AC4's "invite role
 * is member/viewer only, never owner" and "changeRole never grants owner"
 * both start here, at the boundary the client actually hits).
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });

describe('CreateWorkspaceDto', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateWorkspaceDto, data: '' };

  it('accepts a valid name', async () => {
    const result = await pipe.transform({ name: 'Garage' }, metadata);
    expect(result).toBeInstanceOf(CreateWorkspaceDto);
    expect(result.name).toBe('Garage');
  });

  it('rejects a missing name', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
  });

  it('rejects a blank name', async () => {
    await expect(pipe.transform({ name: '' }, metadata)).rejects.toThrow();
  });

  it('rejects a name over 255 chars', async () => {
    await expect(pipe.transform({ name: 'x'.repeat(256) }, metadata)).rejects.toThrow();
  });
});

describe('RenameWorkspaceDto', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: RenameWorkspaceDto, data: '' };

  it('accepts a valid name', async () => {
    const result = await pipe.transform({ name: 'New Name' }, metadata);
    expect(result.name).toBe('New Name');
  });

  it('rejects a missing name', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
  });
});

describe('CreateInviteDto', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateInviteDto, data: '' };

  it('accepts an omitted role (defaults applied by the service, not the DTO)', async () => {
    const result = await pipe.transform({}, metadata);
    expect(result.role).toBeUndefined();
  });

  it('accepts role: "member"', async () => {
    const result = await pipe.transform({ role: 'member' }, metadata);
    expect(result.role).toBe('member');
  });

  it('accepts role: "viewer"', async () => {
    const result = await pipe.transform({ role: 'viewer' }, metadata);
    expect(result.role).toBe('viewer');
  });

  it('REJECTS role: "owner" — an invite can never grant ownership', async () => {
    await expect(pipe.transform({ role: 'owner' }, metadata)).rejects.toThrow();
  });

  it('rejects an unknown role string', async () => {
    await expect(pipe.transform({ role: 'superadmin' }, metadata)).rejects.toThrow();
  });
});

describe('UpdateMemberRoleDto', () => {
  const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateMemberRoleDto, data: '' };

  it('accepts role: "member"', async () => {
    const result = await pipe.transform({ role: 'member' }, metadata);
    expect(result.role).toBe('member');
  });

  it('accepts role: "viewer"', async () => {
    const result = await pipe.transform({ role: 'viewer' }, metadata);
    expect(result.role).toBe('viewer');
  });

  it('REJECTS role: "owner" — ownership can only be granted via transferOwnership', async () => {
    await expect(pipe.transform({ role: 'owner' }, metadata)).rejects.toThrow();
  });

  it('rejects a missing role', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toThrow();
  });
});
