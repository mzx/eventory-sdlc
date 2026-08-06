import AddIcon from '@mui/icons-material/Add';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { AppBar, Button, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Route, Routes } from 'react-router-dom';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { IntakePage } from './pages/IntakePage';
import { ItemsPage } from './pages/ItemsPage';
import { LocationDetailPage } from './pages/LocationDetailPage';
import { LocationsPage } from './pages/LocationsPage';

/** App shell: top AppBar (title + primary "Add item" action) wrapping the
 * routed page content in a responsive, phone-first container. */
export function App() {
  return (
    <>
      <AppBar position="sticky" color="primary" enableColorOnDark>
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none' }}
          >
            Eventory
          </Typography>
          <Button
            component={RouterLink}
            to="/locations"
            color="inherit"
            variant="text"
            startIcon={<PlaceOutlinedIcon />}
            sx={{ mr: 1 }}
          >
            Locations
          </Button>
          <Button
            component={RouterLink}
            to="/intake"
            color="inherit"
            variant="outlined"
            startIcon={<AddIcon />}
          >
            Add item
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 2, px: { xs: 1, sm: 2 } }}>
        <Routes>
          <Route path="/" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/locations/:id" element={<LocationDetailPage />} />
        </Routes>
      </Container>
    </>
  );
}
