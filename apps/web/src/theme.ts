import { createTheme } from '@mui/material';

/**
 * Phone-first theme — this app is used standing in a garage, often one-handed.
 * Bumps default touch targets and keeps the palette high-contrast for
 * workshop lighting.
 */
export const theme = createTheme({
  palette: {
    primary: { main: '#2e7d32' }, // workshop green
    secondary: { main: '#ef6c00' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButtonBase: {
      defaultProps: {
        // Larger tap targets for gloved/one-handed garage use.
        disableRipple: false,
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 44 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: 'none' },
      },
    },
  },
});
