import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceRole } from '@prisma/client';
import { InvitesController, WorkspacesController } from './workspaces.controller';
import { InvitesService, WorkspacesService } from './workspaces.service';

const USER = { id: 'user-1' } as never;
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_USER_ID = '22222222-2222-2222-2222-222222222222';

function makeWorkspacesServiceMock() {
  return {
    create: jest.fn(),
    listMine: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    listMembers: jest.fn(),
    changeRole: jest.fn(),
    transferOwnership: jest.fn(),
    removeMember: jest.fn(),
  };
}

function makeInvitesServiceMock() {
  return {
    create: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    redeem: jest.fn(),
  };
}

describe('WorkspacesController', () => {
  let controller: WorkspacesController;
  let workspacesService: ReturnType<typeof makeWorkspacesServiceMock>;
  let invitesService: ReturnType<typeof makeInvitesServiceMock>;

  beforeEach(async () => {
    workspacesService = makeWorkspacesServiceMock();
    invitesService = makeInvitesServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [
        { provide: WorkspacesService, useValue: workspacesService },
        { provide: InvitesService, useValue: invitesService },
      ],
    }).compile();

    controller = module.get<WorkspacesController>(WorkspacesController);
  });

  it('create delegates to WorkspacesService.create', async () => {
    const created = { id: WORKSPACE_ID };
    workspacesService.create.mockResolvedValue(created);

    const result = await controller.create({ name: 'Garage' }, USER);

    expect(workspacesService.create).toHaveBeenCalledWith('Garage', 'user-1');
    expect(result).toBe(created);
  });

  it('listMine delegates to WorkspacesService.listMine', async () => {
    const rows = [{ id: WORKSPACE_ID }];
    workspacesService.listMine.mockResolvedValue(rows);

    expect(await controller.listMine(USER)).toBe(rows);
    expect(workspacesService.listMine).toHaveBeenCalledWith('user-1');
  });

  it('rename delegates to WorkspacesService.rename', async () => {
    const renamed = { id: WORKSPACE_ID, name: 'New Name' };
    workspacesService.rename.mockResolvedValue(renamed);

    const result = await controller.rename(WORKSPACE_ID, { name: 'New Name' }, USER);

    expect(workspacesService.rename).toHaveBeenCalledWith(WORKSPACE_ID, 'New Name', 'user-1');
    expect(result).toBe(renamed);
  });

  it('remove delegates to WorkspacesService.remove', async () => {
    await controller.remove(WORKSPACE_ID, USER);

    expect(workspacesService.remove).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
  });

  it('listMembers delegates to WorkspacesService.listMembers', async () => {
    const rows = [{ userId: TARGET_USER_ID }];
    workspacesService.listMembers.mockResolvedValue(rows);

    expect(await controller.listMembers(WORKSPACE_ID, USER)).toBe(rows);
    expect(workspacesService.listMembers).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
  });

  it('changeRole delegates to WorkspacesService.changeRole', async () => {
    const updated = { userId: TARGET_USER_ID, role: WorkspaceRole.viewer };
    workspacesService.changeRole.mockResolvedValue(updated);

    const result = await controller.changeRole(
      WORKSPACE_ID,
      TARGET_USER_ID,
      { role: WorkspaceRole.viewer },
      USER,
    );

    expect(workspacesService.changeRole).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TARGET_USER_ID,
      WorkspaceRole.viewer,
      'user-1',
    );
    expect(result).toBe(updated);
  });

  it('transferOwnership delegates to WorkspacesService.transferOwnership', async () => {
    const updated = { userId: TARGET_USER_ID, role: WorkspaceRole.owner };
    workspacesService.transferOwnership.mockResolvedValue(updated);

    const result = await controller.transferOwnership(WORKSPACE_ID, TARGET_USER_ID, USER);

    expect(workspacesService.transferOwnership).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TARGET_USER_ID,
      'user-1',
    );
    expect(result).toBe(updated);
  });

  it('removeMember delegates to WorkspacesService.removeMember', async () => {
    await controller.removeMember(WORKSPACE_ID, TARGET_USER_ID, USER);

    expect(workspacesService.removeMember).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TARGET_USER_ID,
      'user-1',
    );
  });

  it('createInvite delegates to InvitesService.create', async () => {
    const invite = { id: 'invite-1', token: 'raw-token' };
    invitesService.create.mockResolvedValue(invite);

    const result = await controller.createInvite(
      WORKSPACE_ID,
      { role: WorkspaceRole.viewer },
      USER,
    );

    expect(invitesService.create).toHaveBeenCalledWith(
      WORKSPACE_ID,
      WorkspaceRole.viewer,
      'user-1',
    );
    expect(result).toBe(invite);
  });

  it('listInvites delegates to InvitesService.list', async () => {
    const invites = [{ id: 'invite-1' }];
    invitesService.list.mockResolvedValue(invites);

    expect(await controller.listInvites(WORKSPACE_ID, USER)).toBe(invites);
    expect(invitesService.list).toHaveBeenCalledWith(WORKSPACE_ID, 'user-1');
  });

  it('revokeInvite delegates to InvitesService.revoke', async () => {
    await controller.revokeInvite(WORKSPACE_ID, 'invite-1', USER);

    expect(invitesService.revoke).toHaveBeenCalledWith(WORKSPACE_ID, 'invite-1', 'user-1');
  });
});

describe('InvitesController', () => {
  let controller: InvitesController;
  let invitesService: ReturnType<typeof makeInvitesServiceMock>;

  beforeEach(async () => {
    invitesService = makeInvitesServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitesController],
      providers: [{ provide: InvitesService, useValue: invitesService }],
    }).compile();

    controller = module.get<InvitesController>(InvitesController);
  });

  it('redeem delegates to InvitesService.redeem with the token from the body', async () => {
    const result = { workspaceId: WORKSPACE_ID, role: WorkspaceRole.member };
    invitesService.redeem.mockResolvedValue(result);

    expect(await controller.redeem({ token: 'raw-token' }, USER)).toBe(result);
    expect(invitesService.redeem).toHaveBeenCalledWith('raw-token', 'user-1');
  });
});
