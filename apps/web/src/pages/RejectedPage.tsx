import BlockIcon from '@mui/icons-material/Block';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { authLogoutUrl } from '../api';
import { useAuth } from '../auth/AuthContext';

/** Shown by `AuthGate` for a signed-in user with `status === 'rejected'`. */
export function RejectedPage() {
  const { user } = useAuth();

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
          <BlockIcon sx={{ fontSize: 48, color: 'error.main' }} />
          <Typography variant="h6" component="h1">
            Access denied
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.email ?? 'This account'} has been rejected by a household admin. Contact them if
            you believe this is a mistake.
          </Typography>
          <Button variant="outlined" href={authLogoutUrl()}>
            Log out
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
