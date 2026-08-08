// Design-sync bundle entry (see .design-sync/config.json `entry`).
// This app has no library dist — the claude.ai/design bundle is built from
// the app's own component sources via this re-export module. Deliberately
// outside src/ so app tsc/eslint/prettier scripts (scoped to src/**) skip it.
export { ItemCard } from './src/components/ItemCard';
export { LocationTree } from './src/components/LocationTree';
export { QrThumb } from './src/components/QrThumb';
export { ScannerDialog } from './src/components/ScannerDialog';
export { UserMenu } from './src/components/UserMenu';
export { theme } from './src/theme';
// The app's design language IS MUI themed by ./src/theme — expose the full
// MUI surface on the same module instance so provider context (theme, router)
// reaches every component, and stories' own `@mui/material` imports resolve
// to this bundle instead of a duplicate copy.
export * from '@mui/material';
export { MemoryRouter } from 'react-router-dom';
