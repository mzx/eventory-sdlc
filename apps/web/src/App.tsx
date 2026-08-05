import { Alert, Box, CircularProgress, Container, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

export function App() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper elevation={2} sx={{ p: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Eventory
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Workshop home inventory — API health check
        </Typography>
        <Box sx={{ mt: 3 }} data-testid="health-status">
          {isLoading && <CircularProgress size={24} />}
          {isError && <Alert severity="error">{(error as Error).message}</Alert>}
          {data && (
            <Alert severity={data.status === 'ok' && data.db ? 'success' : 'warning'}>
              status: {data.status} — db: {String(data.db)}
            </Alert>
          )}
        </Box>
      </Paper>
    </Container>
  );
}
