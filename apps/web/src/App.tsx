import AddIcon from '@mui/icons-material/Add';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { AppBar, Button, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Route, Routes } from 'react-router-dom';
import { EditItemPage } from './pages/EditItemPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemPrintPage } from './pages/ItemPrintPage';
import { IntakePage } from './pages/IntakePage';
import { ItemsPage } from './pages/ItemsPage';
import { LocationDetailPage } from './pages/LocationDetailPage';
import { LocationsPage } from './pages/LocationsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';

/** Top-level router: the QR sticker print view is deliberately rendered
 * outside `AppShell` (no AppBar, no Container chrome) since it must produce
 * only the sticker + item name when printed — see `ItemPrintPage`. */
export function App() {
  return (
    <Routes>
      <Route path="/items/:id/print" element={<ItemPrintPage />} />
      <Route path="/*" element={<AppShell />} />
    </Routes>
  );
}

/** App shell: top AppBar (title + nav + primary "Add item" action) wrapping
 * the routed page content in a responsive, phone-first container. */
function AppShell() {
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
          <Button component={RouterLink} to="/projects" color="inherit">
            Projects
          </Button>
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
            sx={{ ml: 1 }}
          >
            Add item
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 2, px: { xs: 1, sm: 2 } }}>
        <Routes>
          <Route path="/" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/items/:id/edit" element={<EditItemPage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/locations/:id" element={<LocationDetailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </Container>
    </>
  );
}
