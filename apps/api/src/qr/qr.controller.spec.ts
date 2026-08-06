import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQrServiceMock() {
  return { renderPng: jest.fn() };
}

/** Minimal Express `Response` mock supporting the chained `.set().status().send()` calls. */
function makeResMock() {
  const res = {
    set: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  res.set.mockReturnValue(res);
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QrController', () => {
  let controller: QrController;
  let service: ReturnType<typeof makeQrServiceMock>;

  beforeEach(async () => {
    service = makeQrServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QrController],
      providers: [{ provide: QrService, useValue: service }],
    }).compile();

    controller = module.get<QrController>(QrController);
  });

  it('delegates to QrService.renderPng with the token and raw size param', async () => {
    const png = Buffer.from('fake-png-bytes');
    service.renderPng.mockResolvedValue(png);
    const res = makeResMock();

    await controller.render('some-token', '256', res as never);

    expect(service.renderPng).toHaveBeenCalledWith('some-token', '256');
  });

  it('passes size=undefined through when the query param is omitted', async () => {
    service.renderPng.mockResolvedValue(Buffer.from(''));
    const res = makeResMock();

    await controller.render('some-token', undefined, res as never);

    expect(service.renderPng).toHaveBeenCalledWith('some-token', undefined);
  });

  it('sets Content-Type: image/png and a long-lived Cache-Control header', async () => {
    service.renderPng.mockResolvedValue(Buffer.from('fake-png-bytes'));
    const res = makeResMock();

    await controller.render('some-token', undefined, res as never);

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/png',
        'Cache-Control': expect.stringContaining('immutable'),
      }),
    );
  });

  it('responds 200 with the PNG buffer as the body', async () => {
    const png = Buffer.from('fake-png-bytes');
    service.renderPng.mockResolvedValue(png);
    const res = makeResMock();

    await controller.render('some-token', undefined, res as never);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.send).toHaveBeenCalledWith(png);
  });

  it('propagates NotFoundException from the service for an unknown token (404)', async () => {
    service.renderPng.mockRejectedValue(new NotFoundException('not found'));
    const res = makeResMock();

    await expect(controller.render('unknown', undefined, res as never)).rejects.toThrow(
      NotFoundException,
    );
    // Headers must NOT be written when the token lookup fails.
    expect(res.set).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
