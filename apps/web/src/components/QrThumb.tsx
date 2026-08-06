import PrintIcon from '@mui/icons-material/Print';
import { Box, Button, Stack, Typography } from '@mui/material';
import { qrImageUrl } from '../api';

interface QrThumbProps {
  /** The item/location `qrCode` token (see apps/api QrController). */
  token: string;
  /** Human-readable label rendered under the code and on the printed sticker. */
  label?: string;
  /** Pixel size of the on-screen thumbnail; the printed PNG is fetched at 4x this. */
  size?: number;
}

/**
 * QR sticker thumbnail — renders the scannable PNG served by `GET /api/qr/:token`
 * plus a "Print sticker" action that opens a bare print-friendly popup (image +
 * label only, no app chrome) and triggers the browser print dialog.
 *
 * Shared between the location sticker block (EVT-12) and, later, the item
 * detail page (EVT-10).
 */
export function QrThumb({ token, label, size = 160 }: QrThumbProps) {
  const thumbSrc = qrImageUrl(token, size);
  const printSrc = qrImageUrl(token, size * 4);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=400,height=500');
    if (!printWindow) {
      return;
    }
    printWindow.document.write(
      `<!doctype html><html><head><title>${label ?? token}</title></head>` +
        `<body style="text-align:center;font-family:sans-serif;padding:24px">` +
        `<img src="${printSrc}" alt="QR code" style="width:100%;max-width:320px" />` +
        (label ? `<p style="font-size:14px">${label}</p>` : '') +
        `</body></html>`,
    );
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <Stack alignItems="center" spacing={1} data-testid="qr-thumb">
      <Box
        component="img"
        src={thumbSrc}
        alt={label ? `QR code for ${label}` : 'QR code'}
        sx={{ width: size, height: size, bgcolor: 'grey.50', border: 1, borderColor: 'divider' }}
      />
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          {label}
        </Typography>
      )}
      <Button size="small" startIcon={<PrintIcon />} onClick={handlePrint}>
        Print sticker
      </Button>
    </Stack>
  );
}
