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
import { BrowserQRCodeReader } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractScanPath } from '../lib/scanPath';

interface ScannerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * In-app QR scanner (EVT-13): opens the browser camera via `@zxing/browser`
 * and navigates to the decoded `/r/:token` route as soon as a recognizable
 * Eventory code is found, so users can scan a sticker without leaving the
 * app (no native-camera-app + share-to-browser round trip).
 */
export function ScannerDialog({ open, onClose }: ScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);

    const reader = new BrowserQRCodeReader();
    let cancelled = false;
    let stop: (() => void) | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, err, controls) => {
        stop = controls.stop.bind(controls);
        if (cancelled || !result) {
          // `NotFoundException` fires on essentially every frame with no
          // code in view — only surface genuine camera/decoder errors.
          if (err && !(err instanceof NotFoundException)) {
            setError(err.message || 'Camera error');
          }
          return;
        }
        const path = extractScanPath(result.getText());
        if (!path) {
          // Recognizable QR, but not one of ours — keep scanning silently
          // rather than erroring on every non-Eventory code in view.
          return;
        }
        controls.stop();
        onClose();
        navigate(path);
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
  }, [open, navigate, onClose]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Scan a QR code
        <IconButton aria-label="Close scanner" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Point the camera at an Eventory QR sticker.
          </Typography>
        )}
        <Box
          component="video"
          ref={videoRef}
          data-testid="scanner-video"
          muted
          playsInline
          sx={{ width: '100%', borderRadius: 1, bgcolor: 'grey.900', display: 'block' }}
        />
      </DialogContent>
    </Dialog>
  );
}
