import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

/** What `onCount` resolves with — revealed only AFTER the blind entry submits. */
export interface CountDialogResult {
  bookQuantity: number;
  countedQuantity: number;
  delta: number;
}

interface CountDialogProps {
  open: boolean;
  itemName: string;
  /** Submits the blind count; resolves with the book quantity + delta to reveal. */
  onCount: (quantity: number) => Promise<CountDialogResult>;
  /** Called when the dialog is dismissed — on Cancel (entry step) and on Done (reveal step) alike. */
  onClose: () => void;
}

/**
 * Blind verification count entry (EVT-27 AC 2). Step 1 asks "How many are
 * there?" WITHOUT showing the book quantity anywhere on screen. Step 2,
 * after `onCount` resolves, reveals the book quantity and the computed
 * delta — never before. Shared by `ItemDetailPage` ("Verify count" /
 * opportunistic "how many are actually left?") and `VerificationPage`
 * ("today's count list").
 */
export function CountDialog({ open, itemName, onCount, onClose }: CountDialogProps) {
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState<CountDialogResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setValue('');
    setReveal(null);
    setError(null);
    setPending(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (value.trim() === '') return;
    setPending(true);
    setError(null);
    try {
      const result = await onCount(Number(value));
      setReveal(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record count');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>{reveal ? 'Count recorded' : `Count ${itemName}`}</DialogTitle>
      <DialogContent>
        {!reveal && (
          <>
            <DialogContentText>How many are there?</DialogContentText>
            <TextField
              autoFocus
              margin="dense"
              label="Counted quantity"
              type="number"
              fullWidth
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputProps={{ min: 0, inputMode: 'numeric', pattern: '[0-9]*' }}
            />
          </>
        )}
        {reveal && (
          <Typography variant="body2">
            Book quantity was {reveal.bookQuantity}.{' '}
            {reveal.delta === 0
              ? 'That matches — no adjustment needed.'
              : `Adjusted by ${reveal.delta > 0 ? '+' : ''}${reveal.delta}.`}
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {!reveal && (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={pending || value.trim() === ''}
            >
              Submit count
            </Button>
          </>
        )}
        {reveal && (
          <Button variant="contained" onClick={handleClose}>
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
