import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchItem } from '../api';

/**
 * Stub — full detail view (photo gallery, properties table, QR sticker,
 * edit/delete) arrives in EVT-10. For now this confirms the route resolves
 * and the item loads, so ItemsPage cards have somewhere to navigate to.
 */
export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const itemQuery = useQuery({
    queryKey: ['items', id],
    queryFn: () => fetchItem(id as string),
    enabled: Boolean(id),
  });

  if (itemQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (itemQuery.isError) {
    return (
      <Alert severity="error">
        {itemQuery.error instanceof Error ? itemQuery.error.message : 'Failed to load item'}
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        {itemQuery.data?.name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Full detail view (photos, properties, QR sticker, edit) lands in EVT-10.
      </Typography>
    </Box>
  );
}
