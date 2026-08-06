import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import { Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { photoUrl, type ItemListRow } from '../api';

interface ItemCardProps {
  item: ItemListRow;
}

/** Card grid tile: primary photo thumbnail (or placeholder), name, quantity,
 * location breadcrumb, and tag chips. Click navigates to the item detail page. */
export function ItemCard({ item }: ItemCardProps) {
  const navigate = useNavigate();

  return (
    <Card variant="outlined" data-testid="item-card">
      <CardActionArea onClick={() => navigate(`/items/${item.id}`)}>
        <Box
          sx={{
            aspectRatio: '4 / 3',
            bgcolor: 'grey.100',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {item.primaryPhoto ? (
            <Box
              component="img"
              src={photoUrl(item.primaryPhoto.filename)}
              alt={item.name}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Inventory2OutlinedIcon sx={{ fontSize: 48, color: 'grey.400' }} />
          )}
        </Box>
        <CardContent>
          <Typography variant="subtitle1" component="h2" noWrap>
            {item.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Qty: {item.quantity}
            {item.unit ? ` ${item.unit}` : ''}
          </Typography>
          {item.location && (
            <Typography variant="caption" color="text.secondary" noWrap component="p">
              {item.location.path.replace(/\./g, ' › ')}
            </Typography>
          )}
          {item.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
              {item.tags.map(({ tag }) => (
                <Chip key={tag.id} label={tag.name} size="small" />
              ))}
            </Stack>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
