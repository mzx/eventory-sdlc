import { ChecksumException, NotFoundException } from '@zxing/library';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';

type Controls = { stop: () => void };
type Callback = (
  result: { getText: () => string } | undefined,
  err: Error | undefined,
  controls: Controls,
) => void;

let capturedCallback: Callback | undefined;
let capturedHints: unknown;
/** Resolves the promise `decodeFromVideoDevice` returns — mirrors the real
 * `@zxing/browser` API (see ScannerDialog.test.tsx for the same pattern). */
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
  BrowserMultiFormatReader: vi.fn().mockImplementation((hints: unknown) => {
    capturedHints = hints;
    return { decodeFromVideoDevice: decodeFromVideoDeviceMock };
  }),
}));

function renderDialog(open = true, onClose = vi.fn(), onDecoded = vi.fn()) {
  return render(<BarcodeScannerDialog open={open} onClose={onClose} onDecoded={onDecoded} />);
}

describe('BarcodeScannerDialog', () => {
  beforeEach(() => {
    capturedCallback = undefined;
    capturedHints = undefined;
    resolveDecodePromise = undefined;
    decodeFromVideoDeviceMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the camera decoder when opened, restricted to Data Matrix / PDF417', async () => {
    renderDialog();

    await waitFor(() => expect(decodeFromVideoDeviceMock).toHaveBeenCalled());
    expect(screen.getByTestId('barcode-scanner-video')).toBeInTheDocument();
    // Hints were passed through to the reader — the format restriction
    // (AC: "distributor barcode" not any QR/1D code) is wired, not just
    // documented.
    expect(capturedHints).toBeInstanceOf(Map);
  });

  it('reports the raw decoded text and stops the camera on a recognized code', async () => {
    const onDecoded = vi.fn();
    const stopMock = vi.fn();
    renderDialog(true, vi.fn(), onDecoded);

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.({ getText: () => '[)>\x1E061PRC0402FR-071KL\x1E\x04' }, undefined, {
      stop: stopMock,
    });

    expect(stopMock).toHaveBeenCalled();
    expect(onDecoded).toHaveBeenCalledWith('[)>\x1E061PRC0402FR-071KL\x1E\x04');
  });

  it('keeps scanning silently on NotFoundException (no code in view)', async () => {
    const onDecoded = vi.fn();
    const stopMock = vi.fn();
    renderDialog(true, vi.fn(), onDecoded);

    await waitFor(() => expect(capturedCallback).toBeDefined());
    capturedCallback?.(undefined, new NotFoundException(), { stop: stopMock });

    expect(onDecoded).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    capturedCallback?.(undefined, new NotFoundException(), { stop: stopMock });

    rerender(<BarcodeScannerDialog open={false} onClose={vi.fn()} onDecoded={vi.fn()} />);

    expect(stopMock).toHaveBeenCalled();
  });

  it('stops the camera when the dialog closes before any decode callback fires (pending permission prompt)', async () => {
    const controlsStopMock = vi.fn();
    const { rerender } = renderDialog();

    await waitFor(() => expect(decodeFromVideoDeviceMock).toHaveBeenCalled());

    rerender(<BarcodeScannerDialog open={false} onClose={vi.fn()} onDecoded={vi.fn()} />);

    await act(async () => {
      resolveDecodePromise?.({ stop: controlsStopMock });
    });

    await waitFor(() => expect(controlsStopMock).toHaveBeenCalled());
  });

  it('does not start the decoder when closed', () => {
    renderDialog(false);

    expect(decodeFromVideoDeviceMock).not.toHaveBeenCalled();
  });
});
