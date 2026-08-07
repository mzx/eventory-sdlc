import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { authLogoutUrl } from '../api';
import { useAuth } from '../auth/AuthContext';

/**
 * Shown by `AuthGate` for a signed-in user with `status === 'pending'`.
 * "Check again" re-fetches `/api/auth/me` — once an admin approves them
 * (EVT-15 AC2), the next refresh lands them in the app with no re-login
 * needed.
 */
export function PendingPage() {
  const { user, refresh } = useAuth();
  const [checking, setChecking] = useState(false);

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        px: 2,
      }}
    >
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <Stack spacing={3} alignItems="center">
          <HourglassTopIcon sx={{ fontSize: 48, color: 'grey.500' }} />
          <Typography variant="h6" component="h1">
            Waiting for approval
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.email ?? 'Your account'} is signed in but hasn&apos;t been approved by a
            household admin yet.
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={handleRefresh}
              disabled={checking}
              startIcon={checking ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              Check again
            </Button>
            <Button variant="outlined" href={authLogoutUrl()}>
              Log out
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
