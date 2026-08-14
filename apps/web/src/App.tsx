import AddIcon from '@mui/icons-material/Add';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import QrCodeScannerOutlinedIcon from '@mui/icons-material/QrCodeScannerOutlined';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import {
  AppBar,
  Badge,
  Button,
  Container,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Link as RouterLink, Navigate, Route, Routes } from 'react-router-dom';
import { fetchShoppingList, fetchVerificationQueue } from './api';
import { AuthGate } from './auth/AuthGate';
import { useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
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
import { PickListPage } from './pages/PickListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ScanPage } from './pages/ScanPage';
import { ShoppingListPage } from './pages/ShoppingListPage';
import { VerificationPage } from './pages/VerificationPage';

/** Top-level router: the QR sticker print view and the kitting pick list are
 * deliberately rendered outside `AppShell` (no AppBar, no Container chrome)
 * since they must produce only their own content when printed — see
 * `ItemPrintPage` and `PickListPage` (EVT-29 AC 5).
 *
 * `AuthGate` wraps everything (including these print-friendly routes) so a
 * signed-out visit to ANY path resolves to `LoginPage` rather than briefly
 * rendering app content (EVT-15 AC1). */
export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/items/:id/print" element={<ItemPrintPage />} />
        <Route path="/projects/:id/pick-list" element={<PickListPage />} />
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
  const openScanner = useCallback(() => setScannerOpen(true), []);

  // Phone nav breakpoint (EVT-35 AC1/3) — below `md` the AppBar toolbar's
  // five text buttons crush/overflow (see task description for the
  // measured ~750-850px minimum); collapse to a bottom nav instead. `md`
  // itself keeps the desktop toolbar unchanged (AC3).
  const theme = useTheme();
  const isDesktopNav = useMediaQuery(theme.breakpoints.up('md'));

  // Nav badge (EVT-26 AC 6) — same ['shopping-list'] query key the
  // Shopping List page and both "Running low"/"Restocked" mutations
  // invalidate, so the count here can never drift from the list itself.
  const shoppingListQuery = useQuery({ queryKey: ['shopping-list'], queryFn: fetchShoppingList });
  const openShoppingListCount = shoppingListQuery.data?.length ?? 0;

  // Nav badge (EVT-27) — same ['verification-queue'] query key
  // VerificationPage and the count/consume mutations invalidate.
  const verificationQuery = useQuery({
    queryKey: ['verification-queue'],
    queryFn: fetchVerificationQueue,
  });
  const overdueVerificationCount = verificationQuery.data?.length ?? 0;

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
          {isDesktopNav && (
            <>
              <Button
                color="inherit"
                variant="text"
                startIcon={<QrCodeScannerOutlinedIcon />}
                onClick={openScanner}
              >
                Scan
              </Button>
              <Button component={RouterLink} to="/projects" color="inherit">
                Projects
              </Button>
              <Button
                component={RouterLink}
                to="/shopping-list"
                color="inherit"
                variant="text"
                startIcon={
                  <Badge badgeContent={openShoppingListCount} color="error">
                    <ShoppingCartOutlinedIcon />
                  </Badge>
                }
                sx={{ mr: 1 }}
              >
                Shopping List
              </Button>
              <Button
                component={RouterLink}
                to="/verification"
                color="inherit"
                variant="text"
                startIcon={
                  <Badge badgeContent={overdueVerificationCount} color="error">
                    <FactCheckOutlinedIcon />
                  </Badge>
                }
                sx={{ mr: 1 }}
              >
                Verification
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
            </>
          )}
          {user && <UserMenu user={user} />}
        </Toolbar>
      </AppBar>
      <ScannerDialog open={scannerOpen} onClose={closeScanner} />
      {!isDesktopNav && (
        <BottomNav
          openShoppingListCount={openShoppingListCount}
          overdueVerificationCount={overdueVerificationCount}
          onScanClick={openScanner}
        />
      )}
      <Container
        maxWidth="lg"
        sx={{
          py: 2,
          px: { xs: 1, sm: 2 },
          // Bottom nav is fixed/overlaid at xs/sm (EVT-35 AC4) — reserve
          // room below the last row of content, plus the iOS standalone
          // PWA safe-area inset so the home-indicator gesture bar never
          // sits on top of an unpadded bottom nav either.
          pb: isDesktopNav ? 2 : 'calc(64px + env(safe-area-inset-bottom))',
        }}
      >
        <Routes>
          <Route path="/" element={<ItemsPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/items/:id/edit" element={<EditItemPage />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/locations/:id" element={<LocationDetailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/shopping-list" element={<ShoppingListPage />} />
          <Route path="/verification" element={<VerificationPage />} />
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
