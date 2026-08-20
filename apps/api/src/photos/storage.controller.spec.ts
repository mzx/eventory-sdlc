import { NotFoundException } from '@nestjs/common';
import { StorageController } from './storage.controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const CURRENT_WORKSPACE = { id: WORKSPACE_ID, role: 'member' } as never;

function makePrismaMock() {
  return {
    photo: {
      findFirst: jest.fn(),
    },
  };
}

function makeResMock() {
  return {
    set: jest.fn(),
    sendFile: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageController (EVT-40)', () => {
  let controller: StorageController;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let resMock: ReturnType<typeof makeResMock>;

  beforeEach(() => {
    prismaMock = makePrismaMock();
    resMock = makeResMock();
    controller = new StorageController(prismaMock as never);
  });

  it("serves the file with the stored mimetype when the photo belongs to the caller's workspace", async () => {
    prismaMock.photo.findFirst.mockResolvedValue({
      filename: 'abc.png',
      mimeType: 'image/png',
    });

    await controller.serve('abc.png', CURRENT_WORKSPACE, resMock as never);

    expect(prismaMock.photo.findFirst).toHaveBeenCalledWith({
      where: { filename: 'abc.png', workspaceId: WORKSPACE_ID },
      select: { filename: true, mimeType: true },
    });
    expect(resMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      }),
    );
    expect(resMock.sendFile).toHaveBeenCalledWith(expect.stringContaining('abc.png'));
  });

  it('EVT-40 AC 3: throws NotFoundException for a foreign-workspace or unknown filename, without sending a file', async () => {
    prismaMock.photo.findFirst.mockResolvedValue(null);

    await expect(
      controller.serve('foreign.png', CURRENT_WORKSPACE, resMock as never),
    ).rejects.toThrow(NotFoundException);
    expect(resMock.sendFile).not.toHaveBeenCalled();
  });
});
