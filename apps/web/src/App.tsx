import AddIcon from '@mui/icons-material/Add';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import { AppBar, Button, Container, Toolbar, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Link as RouterLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from './auth/AuthGate';
import { useAuth } from './auth/AuthContext';
import { ScannerDialog } from './components/ScannerDialog';
import { UserMenu } from './components/UserMenu';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { EditItemPage } from './pages/EditItemPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemPrintPage } from './pages/ItemPrintPage';
import { IntakePage } from './pages/IntakePage';
import { ItemsPage } from './pages/ItemsPage';
import { LocationDetailPage } from './pages/LocationDetailPage';
import { LocationsPage } from './pages/LocationsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ScanPage } from './pages/ScanPage';

/** Top-level router: the QR sticker print view is deliberately rendered
 * outside `AppShell` (no AppBar, no Container chrome) since it must produce
 * only the sticker + item name when printed — see `ItemPrintPage`.
 *
 * `AuthGate` wraps everything (including the print route) so a signed-out
 * visit to ANY path — print view included — resolves to `LoginPage` rather
 * than briefly rendering app content (EVT-15 AC1). */
export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/items/:id/print" element={<ItemPrintPage />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </AuthGate>
  );
}

/** Redirects non-admins away from `/admin/*` — AC3. `AuthGate` has already
 * guaranteed `user` is non-null and approved by the time `AppShell` mounts. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** App shell: top AppBar (title + nav + primary "Add item" action + user
 * menu) wrapping the routed page content in a responsive, phone-first
 * container. Only ever mounted for an approved, signed-in user — `AuthGate`
 * renders LoginPage/PendingPage/RejectedPage instead otherwise. */
function AppShell() {
  const { user } = useAuth();
  const [scannerOpen, setScannerOpen] = useState(false);
  const closeScanner = useCallback(() => setScannerOpen(false), []);

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
            color="inherit"
            variant="text"
            startIcon={<QrCodeScannerOutlinedIcon />}
            onClick={() => setScannerOpen(true)}
          >
            Scan
          </Button>
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
            color="primary"
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ ml: 1 }}
          >
            Add item
          </Button>
          {user && <UserMenu user={user} />}
        </Toolbar>
      </AppBar>
      <ScannerDialog open={scannerOpen} onClose={closeScanner} />
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
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsersPage />
              </RequireAdmin>
            }
          />
          <Route path="/r/:token" element={<ScanPage />} />
        </Routes>
      </Container>
    </>
  );
}
