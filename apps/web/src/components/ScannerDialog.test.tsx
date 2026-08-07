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

type Controls = { stop: () => void };
type Callback = (
  result: { getText: () => string } | undefined,
  err: Error | undefined,
  controls: Controls,
) => void;

let capturedCallback: Callback | undefined;
/** Resolves the promise `decodeFromVideoDevice` returns — mirrors the real
 * `@zxing/browser` API, whose promise can resolve either before or after
 * the first per-frame callback (see ScannerDialog finding #1). Tests control
 * this explicitly to exercise both orderings. */
let resolveDecodePromise: ((controls: Controls) => void) | undefined;

const decodeFromVideoDeviceMock = vi.fn(
  (_deviceId: string | undefined, _video: unknown, cb: Callback) => {
    capturedCallback = cb;
    return new Promise<Controls>((resolve) => {
      resolveDecodePromise = resolve;
    });
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
    resolveDecodePromise = undefined;
    decodeFromVideoDeviceMock.mockClear();
    navigateMock.mockClear();
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
    const stopMock = vi.fn();
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
    const stopMock = vi.fn();
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.(undefined, new NotFoundException(), { stop: stopMock });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps scanning silently when a non-Eventory QR code is decoded', async () => {
    const stopMock = vi.fn();
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.({ getText: () => 'https://example.com/unrelated' }, undefined, {
      stop: stopMock,
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows an error alert on a genuine decoder error', async () => {
    const stopMock = vi.fn();
    renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    act(() => {
      capturedCallback?.(undefined, new ChecksumException('bad checksum'), { stop: stopMock });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('bad checksum');
  });

  it('stops the camera when the dialog closes after the first decode callback fired', async () => {
    const stopMock = vi.fn();
    const { rerender } = renderDialog();

    await waitFor(() => expect(capturedCallback).toBeDefined());
    // A frame callback has fired (e.g. a NotFoundException on an empty
    // frame), which is how the real reader hands the component its
    // long-lived `controls` in the common case.
    capturedCallback?.(undefined, new NotFoundException(), { stop: stopMock });

    rerender(
      <MemoryRouter>
        <ScannerDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(stopMock).toHaveBeenCalled();
  });

  it('stops the camera when the dialog closes before any decode callback fires (pending permission prompt)', async () => {
    const controlsStopMock = vi.fn();
    const { rerender } = renderDialog();

    await waitFor(() => expect(decodeFromVideoDeviceMock).toHaveBeenCalled());
    // The frame callback has never been *invoked* (no frame decoded yet —
    // camera permission prompt still pending) and the `decodeFromVideoDevice`
    // promise has not resolved either, so closing here exercises the
    // `.then()` capture path from finding #1, not the frame callback's
    // `stop` assignment.

    rerender(
      <MemoryRouter>
        <ScannerDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // The promise resolves only now (e.g. the user granted camera access
    // just after closing the dialog) — the effect must still stop it.
    await act(async () => {
      resolveDecodePromise?.({ stop: controlsStopMock });
    });

    await waitFor(() => expect(controlsStopMock).toHaveBeenCalled());
  });
});
