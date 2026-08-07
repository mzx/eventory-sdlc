import { ChecksumException, NotFoundException } from '@zxing/library';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScannerDialog } from './ScannerDialog';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const stopMock = vi.fn();
type Callback = (
  result: { getText: () => string } | undefined,
  err: Error | undefined,
  controls: { stop: () => void },
) => void;
let capturedCallback: Callback | undefined;
const decodeFromVideoDeviceMock = vi.fn(
  (_deviceId: string | undefined, _video: unknown, cb: Callback) => {
    capturedCallback = cb;
    return Promise.resolve({ stop: stopMock });
  },
);

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: vi.fn().mockImplementation(() => ({
    decodeFromVideoDevice: decodeFromVideoDeviceMock,
  })),
}));

function renderDialog(open = true, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <ScannerDialog open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('ScannerDialog', () => {
  beforeEach(() => {
    capturedCallback = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the camera decoder when opened', async () => {
    renderDialog();

    await waitFor(() => expect(decodeFromVideoDeviceMock).toHaveBeenCalled());
    expect(screen.getByTestId('scanner-video')).toBeInTheDocument();
  });

  it('navigates to the decoded /r/:token path and closes on a recognized code', async () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.({ getText: () => 'https://eventory.example.com/r/token-abc' }, undefined, {
      stop: stopMock,
    });

    expect(stopMock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/r/token-abc');
  });

  it('keeps scanning silently on NotFoundException (no code in view)', async () => {
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.(undefined, new NotFoundException(), { stop: stopMock });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps scanning silently when a non-Eventory QR code is decoded', async () => {
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.({ getText: () => 'https://example.com/unrelated' }, undefined, {
      stop: stopMock,
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows an error alert on a genuine decoder error', async () => {
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    act(() => {
      capturedCallback?.(undefined, new ChecksumException('bad checksum'), { stop: stopMock });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('bad checksum');
  });

  it('stops the scanner when the dialog closes', async () => {
    const { rerender } = renderDialog();

    await waitFor(() => expect(decodeFromVideoDeviceMock).toHaveBeenCalled());

    rerender(
      <MemoryRouter>
        <ScannerDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(stopMock).toHaveBeenCalled();
  });
});
