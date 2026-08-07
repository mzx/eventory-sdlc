import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import { LoginPage } from '../pages/LoginPage';
import { PendingPage } from '../pages/PendingPage';
import { RejectedPage } from '../pages/RejectedPage';
import { useAuth } from './AuthContext';

/**
 * Gates `children` (the routed app shell) behind auth state:
 * loading → spinner; signed out → `LoginPage`; `pending` → `PendingPage`;
 * `rejected` → `RejectedPage`; `approved` → renders `children`.
 *
 * Mounted once around the whole router in `App.tsx` so a signed-out visit
 * to ANY route resolves straight to `LoginPage` without ever mounting (and
 * therefore never flashing) the routed app content — EVT-15 AC1.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
        data-testid="auth-loading"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (user.status === 'pending') {
    return <PendingPage />;
  }

  if (user.status === 'rejected') {
    return <RejectedPage />;
  }

  return <>{children}</>;
}
