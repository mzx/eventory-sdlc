import CloseIcon from '@mui/icons-material/Close';
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';

interface BarcodeScannerDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called once with the raw decoded text the first time a Data Matrix /
   * PDF417 code is recognized in view. Mirrors `ScannerDialog`'s
   * onClose-then-act pattern: this dialog does NOT close itself — the
   * caller decides (e.g. IntakePage closes it and parses the text).
   */
  onDecoded: (text: string) => void;
}

/**
 * Restricts the decoder to the two 2D symbologies distributor labels
 * actually use (EVT-31 goal) — narrower hints also make `zxing`'s decode
 * loop faster per frame than the unrestricted `MultiFormatReader` default.
 */
const BARCODE_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417]],
]);

/**
 * In-app Data Matrix / PDF417 scanner for distributor barcode receiving
 * (EVT-31): opens the browser camera and decodes with `@zxing/library`
 * (already a dependency for EVT-13's QR scanner), reporting the raw
 * decoded text back to the caller for ECIA field parsing.
 *
 * Decoding stays entirely client-side (AC 5) — no frame or image is ever
 * sent to a server.
 *
 * `BarcodeDetector` evaluation: the native `BarcodeDetector` Web API can
 * decode `data_matrix`/`pdf417` on Chromium/Android, but has no support at
 * all on Safari or Firefox as of this task's research pass (research/
 * parts-logistics-at-scale.md), and even where present, support for these
 * two specific formats (as opposed to `qr_code`) is inconsistent across
 * Chromium builds. Shipping a dual code path (native detector + zxing
 * fallback) would roughly double this component's surface area and test
 * burden for a browser-support win that's still partial today. `zxing`
 * alone already satisfies every acceptance criterion (client-side,
 * DataMatrix + PDF417, works everywhere the rest of this app already
 * requires a camera) and matches the existing `ScannerDialog` pattern, so
 * it is used unconditionally here; revisit if/when `BarcodeDetector`
 * format support broadens.
 */
export function BarcodeScannerDialog({ open, onClose, onDecoded }: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);

    const reader = new BrowserMultiFormatReader(BARCODE_HINTS);
    let cancelled = false;
    let stop: (() => void) | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, err, controls) => {
        stop = controls.stop.bind(controls);
        if (cancelled || !result) {
          // `NotFoundException` fires on essentially every frame with no
          // code in view — only surface genuine camera/decoder errors
          // (same contract as ScannerDialog).
          if (err && !(err instanceof NotFoundException)) {
            setError(err.message || 'Camera error');
          }
          return;
        }
        controls.stop();
        onDecoded(result.getText());
      })
      .then((controls) => {
        // See ScannerDialog's identical comment: `decodeFromVideoDevice`
        // can resolve before OR after the first frame callback fires, so
        // closing mid-permission-prompt must still stop the track here.
        if (cancelled) {
          controls.stop();
        } else {
          stop = controls.stop.bind(controls);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to access the camera');
        }
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open, onDecoded]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Scan supplier barcode
        <IconButton aria-label="Close scanner" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Point the camera at the distributor&apos;s Data Matrix or PDF417 label.
          </Typography>
        )}
        <Box
          component="video"
          ref={videoRef}
          data-testid="barcode-scanner-video"
          muted
          playsInline
          sx={{ width: '100%', borderRadius: 1, bgcolor: 'grey.900', display: 'block' }}
        />
      </DialogContent>
    </Dialog>
  );
}
