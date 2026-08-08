import { CssBaseline, ThemeProvider } from '@mui/material';
import type { Preview } from '@storybook/react-vite';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { theme } from '../src/theme';

/**
 * Mirrors the app shell in `src/main.tsx`: every component renders inside the
 * workshop MUI theme with CssBaseline, and inside a router (components use
 * `useNavigate`/`RouterLink`). Query client and auth context are omitted —
 * no component under `src/components/` reads them directly.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      </ThemeProvider>
    ),
  ],
};

export default preview;
