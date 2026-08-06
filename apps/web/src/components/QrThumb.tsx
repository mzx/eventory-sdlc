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
    // Sever the opener reference so the popup can't reach back into this
    // window. (`window.open(..., 'noopener')` would do this for us but also
    // makes the return value null, which we need below to keep scripting
    // the popup.)
    printWindow.opener = null;

    // Build the popup document via the DOM API — never interpolate `label`
    // (or `token`) into an HTML string. `label` is user-influenced (location
    // names today; this component is shared with free-text item names in
    // EVT-10), so string interpolation into markup would be a stored-XSS
    // sink in this origin.
    const doc = printWindow.document;
    doc.title = label ?? token;

    const body = doc.body;
    body.style.textAlign = 'center';
    body.style.fontFamily = 'sans-serif';
    body.style.padding = '24px';

    const img = doc.createElement('img');
    img.src = printSrc;
    img.alt = 'QR code';
    img.style.width = '100%';
    img.style.maxWidth = '320px';
    body.appendChild(img);

    if (label) {
      const caption = doc.createElement('p');
      caption.style.fontSize = '14px';
      caption.textContent = label;
      body.appendChild(caption);
    }

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
