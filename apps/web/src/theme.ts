import { createTheme } from '@mui/material';
import type { Shadows } from '@mui/material/styles';

/**
 * Blueprint theme — the app as a workshop technical drawing. Deep Prussian
 * blue drafting paper with a minor/major grid, panels drawn with 1px line
 * borders instead of shadows (line work carries ALL depth — the elevation
 * ramp is flat), monospace annotations for headings/labels, and a single
 * cyan accent for actions and focus.
 *
 * Phone-first constraints kept from the original theme: this app is used
 * standing in a garage, often one-handed/gloved — tap targets stay >= 44px
 * and body text holds >= 4.5:1 against its surface (workshop lighting,
 * glare).
 */

// --- Drafting paper ---------------------------------------------------------
const CANVAS = '#0b2138'; // deep blueprint paper
const PANEL = '#0f2a46'; // drawn panels (cards, menus, dialogs)
const PANEL_HIGH = '#123152'; // hover/raised panel tone
const APPBAR = '#081b30'; // title block bar

// --- Line work --------------------------------------------------------------
const LINE = 'rgba(159, 198, 232, 0.32)'; // standard drawn line
const LINE_FAINT = 'rgba(159, 198, 232, 0.16)';
const LINE_STRONG = 'rgba(159, 198, 232, 0.55)';

// --- Ink & accent -----------------------------------------------------------
const INK = '#e8f2fb'; // primary text, ~13:1 on PANEL
const INK_DIM = '#a9c4dc'; // annotations, ~7:1 on PANEL
const ACCENT = '#64d2ff'; // cyan — actions, focus, "live" lines
const ACCENT_INK = '#062036'; // text on cyan fills, ~9:1

// Drafting annotations (headings, buttons, captions) are monospace; body
// copy stays on the system sans stack for reading comfort.
const MONO = '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace';

/** Dashed drafting focus indicator — unmistakable on any panel tone. */
const FOCUS_OUTLINE = {
  outline: '2px dashed rgba(100, 210, 255, 0.9)',
  outlineOffset: '2px',
} as const;

/** Blueprint is flat line work: every MUI elevation renders no shadow. */
const flatShadows = Array(25).fill('none') as unknown as Shadows;

/**
 * Frosted drawing panel for list/tree surfaces: translucent fill with a
 * backdrop blur, so the drafting grid shows through softly instead of
 * running hard behind row text. Use on CONTAINER panels (a tree, a table),
 * never per-row/per-card — backdrop-filter is GPU-expensive when repeated.
 */
export const frostedPanel = {
  bgcolor: 'rgba(15, 42, 70, 0.55)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${LINE}`,
  borderRadius: '2px',
} as const;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    // Cyan accent: the "live" line on the drawing — actions, focus, links.
    primary: { main: ACCENT, light: '#8fdfff', dark: '#3ba9d6', contrastText: ACCENT_INK },
    // Draftsman's red-pencil markup, muted; keeps color="secondary" API alive.
    secondary: { main: '#e8927c', light: '#f2ac99', dark: '#c76f5a', contrastText: '#2a0f08' },
    // Severity stays chromatic — safety signal, not drawing style.
    error: { main: '#ef8a80' },
    warning: { main: '#ffc66e' },
    info: { main: '#7dc4e8' },
    success: { main: '#8fd6a0' },
    background: { default: CANVAS, paper: PANEL },
    divider: LINE,
    text: {
      primary: INK,
      secondary: INK_DIM,
      disabled: 'rgba(232, 242, 251, 0.42)',
    },
    // Ramp re-centered on blueprint tones so existing component tokens
    // resolve with zero edits: grey.900 stays near-black-navy (ScannerDialog
    // video well), grey.400/500 are legible line-blue icon tones (ItemCard,
    // ItemsPage, ProjectsPage, PendingPage placeholder icons).
    grey: {
      50: '#eef5fb',
      100: '#dce9f5',
      200: '#bcd6ec',
      300: '#9fc6e8',
      400: '#7fa5c8', // ~5:1 on CANVAS — decorative 48px icons stay visible
      500: '#6f95b8',
      600: '#41648a',
      700: '#28496e',
      800: '#123152',
      900: '#081726',
      A100: '#dce9f5',
      A200: '#bcd6ec',
      A400: '#7fa5c8',
      A700: '#28496e',
    },
    action: {
      active: '#bcd6ec',
      hover: 'rgba(159, 198, 232, 0.08)',
      selected: 'rgba(159, 198, 232, 0.14)',
      disabled: 'rgba(232, 242, 251, 0.3)',
      disabledBackground: 'rgba(159, 198, 232, 0.12)',
      focus: 'rgba(100, 210, 255, 0.24)',
    },
  },
  // Drafting corners are sharp.
  shape: { borderRadius: 2 },
  shadows: flatShadows,
  typography: {
    button: { fontFamily: MONO, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 1 },
    h5: { fontFamily: MONO, fontWeight: 600, letterSpacing: 0.5 },
    h6: { fontFamily: MONO, fontWeight: 600, letterSpacing: 0.5 },
    subtitle1: { fontFamily: MONO, fontWeight: 600 },
    caption: { fontFamily: MONO, letterSpacing: 0.4 }, // breadcrumbs read as annotations
    overline: { fontFamily: MONO, letterSpacing: 1.5 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: 'dark' },
        // The drafting paper: minor 8px grid + major 40px grid.
        body: {
          backgroundColor: CANVAS,
          backgroundImage:
            `linear-gradient(${'rgba(159,198,232,0.022)'} 1px, transparent 1px), ` +
            `linear-gradient(90deg, ${'rgba(159,198,232,0.022)'} 1px, transparent 1px), ` +
            `linear-gradient(${'rgba(159,198,232,0.04)'} 1px, transparent 1px), ` +
            `linear-gradient(90deg, ${'rgba(159,198,232,0.04)'} 1px, transparent 1px)`,
          backgroundSize: '8px 8px, 8px 8px, 40px 40px, 40px 40px',
        },
        // Printers drop dark backgrounds — force ink-on-white for print so
        // the QR sticker routes (ItemPrintPage) stay legible.
        '@media print': {
          body: { backgroundColor: '#ffffff', backgroundImage: 'none', color: '#000000' },
        },
      },
    },
    MuiButtonBase: {
      defaultProps: {
        // Keep the ripple: with gloves, visible touch acknowledgement matters.
        disableRipple: false,
      },
    },
    MuiPaper: {
      styleOverrides: {
        // Panels are drawn, not lit: solid fill + line border, no overlay.
        root: {
          backgroundImage: 'none',
          border: `1px solid ${LINE}`,
        },
        outlined: { borderColor: LINE },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          overflow: 'hidden',
          border: `1px solid ${LINE}`,
          backgroundColor: PANEL,
          transition: 'border-color 120ms ease, background-color 120ms ease',
          '&:hover': { borderColor: LINE_STRONG },
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: '2px dashed rgba(100, 210, 255, 0.9)',
            outlineOffset: '-4px',
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44, // gloved-thumb tap target, all sizes incl. size="small"
          borderRadius: 2,
          transition: 'border-color 120ms ease, background-color 120ms ease',
          '&.Mui-focusVisible': FOCUS_OUTLINE,
        },
        // Neutral contained buttons: filled panel with a drawn border.
        contained: {
          backgroundColor: PANEL_HIGH,
          border: `1px solid ${LINE}`,
          color: INK,
          '&:hover': { backgroundColor: '#16395f', borderColor: LINE_STRONG },
          '&:active': { backgroundColor: '#0d2743' },
        },
        // The one loud element: solid cyan CTA — the "live" line made a block.
        containedPrimary: {
          backgroundColor: ACCENT,
          border: '1px solid rgba(255, 255, 255, 0.25)',
          color: ACCENT_INK,
          '&:hover': { backgroundColor: '#8fdfff' },
          '&:active': { backgroundColor: '#3ba9d6' },
        },
        containedSecondary: {
          backgroundColor: '#e8927c',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: '#2a0f08',
          '&:hover': { backgroundColor: '#f2ac99' },
        },
        outlined: {
          borderColor: LINE_STRONG,
          color: INK,
          backgroundColor: 'transparent',
          '&:hover': { borderColor: ACCENT, backgroundColor: 'rgba(100, 210, 255, 0.08)' },
          '&:active': { backgroundColor: 'rgba(100, 210, 255, 0.14)' },
        },
        outlinedPrimary: { borderColor: 'rgba(100, 210, 255, 0.6)', color: ACCENT },
        text: {
          color: INK_DIM,
          '&:hover': { backgroundColor: 'rgba(159, 198, 232, 0.1)', color: INK },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: INK_DIM,
          borderRadius: 2,
          '&:hover': { backgroundColor: 'rgba(159, 198, 232, 0.1)', color: INK },
          '&.Mui-focusVisible': FOCUS_OUTLINE,
          '&.Mui-disabled': { color: 'rgba(232, 242, 251, 0.24)' },
        },
        sizeSmall: {
          // Keep the compact visual (LocationTree row density) but extend the
          // touch target to ~44px with an invisible hit area — ButtonBase is
          // position: relative, so the overlay anchors to the button.
          padding: 6,
          '&::after': { content: '""', position: 'absolute', inset: -6 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        // Tags read as drawn labels: line box, mono text, sharp corners.
        root: {
          fontFamily: MONO,
          fontWeight: 500,
          borderRadius: 2,
          letterSpacing: 0.3,
        },
        filled: {
          backgroundColor: 'rgba(159, 198, 232, 0.12)',
          border: `1px solid ${LINE}`,
          color: '#cfe2f3',
        },
        colorPrimary: {
          backgroundColor: 'rgba(100, 210, 255, 0.14)',
          border: '1px solid rgba(100, 210, 255, 0.45)',
          color: ACCENT,
        },
        // Count badges (LocationTree): quiet dotted-line boxes.
        outlined: {
          borderStyle: 'dashed',
          borderColor: LINE,
          backgroundColor: 'transparent',
          color: INK_DIM,
        },
        deleteIcon: {
          color: 'rgba(232, 242, 251, 0.4)',
          '&:hover': { color: 'rgba(232, 242, 251, 0.75)' },
        },
        // Filter chips are 32px tall by default — below the 44px gloved-thumb
        // commitment MuiButton/MuiIconButton enforce elsewhere. Same
        // invisible-hit-area trick as MuiIconButton's sizeSmall (above):
        // extend the actual hit target without changing the drawn chip.
        clickable: {
          position: 'relative',
          '&::after': { content: '""', position: 'absolute', inset: -6 },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        // Fields are drawn boxes on the paper — transparent fill, line border.
        root: {
          backgroundColor: 'rgba(8, 23, 38, 0.5)',
          borderRadius: 2,
          '&.MuiInputBase-sizeSmall': { minHeight: 44 }, // LocationTree inline editors
          '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: LINE_STRONG },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: ACCENT,
            borderWidth: 1,
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#ef8a80' },
        },
        input: {
          '&::placeholder': { color: '#7fa5c8', opacity: 1 }, // ~4.9:1 on the well
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontFamily: MONO,
          color: INK_DIM,
          '&.Mui-focused': { color: ACCENT },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        // Detail view: a drawn panel with a heavier outer construction line.
        paper: {
          borderRadius: 2,
          backgroundColor: PANEL,
          border: `1px solid ${LINE_STRONG}`,
          boxShadow: `0 0 0 4px rgba(159, 198, 232, 0.08)`,
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontFamily: MONO, fontWeight: 600, letterSpacing: 0.5 },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { backgroundColor: 'rgba(4, 14, 26, 0.72)' },
        invisible: { backgroundColor: 'transparent' },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        // The drawing's title block: darkest band, double rule underneath.
        root: {
          backgroundImage: 'none',
          border: 'none',
          borderBottom: `1px solid ${LINE_STRONG}`,
          borderRadius: 0,
          boxShadow: '0 4px 0 -3px rgba(159, 198, 232, 0.22)',
        },
        colorPrimary: { backgroundColor: APPBAR, color: INK },
      },
    },
    MuiMenu: {
      styleOverrides: {
        // Frosted: the dropdown floats over the grid, blurring it beneath.
        paper: {
          borderRadius: 2,
          backgroundColor: 'rgba(15, 42, 70, 0.72)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: `1px solid ${LINE_STRONG}`,
          boxShadow: '0 0 0 4px rgba(159, 198, 232, 0.08)',
          marginTop: 4,
        },
        list: { padding: 4 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 44, // thumb-sized menu rows (UserMenu)
          borderRadius: 2,
          margin: '1px 2px',
          '&:hover': { backgroundColor: 'rgba(159, 198, 232, 0.1)' },
          '&.Mui-focusVisible': { backgroundColor: 'rgba(100, 210, 255, 0.14)' },
          '&.Mui-selected': { backgroundColor: 'rgba(159, 198, 232, 0.14)' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 2,
          '&:hover': { backgroundColor: 'rgba(159, 198, 232, 0.08)' },
          '&.Mui-focusVisible': {
            outline: '2px dashed rgba(100, 210, 255, 0.9)',
            outlineOffset: '-2px',
          },
          '&.Mui-selected': {
            backgroundColor: 'rgba(100, 210, 255, 0.1)',
            borderLeft: `2px solid ${ACCENT}`,
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        // Callout annotations.
        tooltip: {
          fontFamily: MONO,
          backgroundColor: '#0d2743',
          color: INK,
          border: `1px solid ${LINE_STRONG}`,
          borderRadius: 2,
          fontSize: '0.72rem',
          letterSpacing: 0.3,
        },
        arrow: { color: '#0d2743' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        // Keep severity tints readable on the drawing; just square it off.
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
          border: `1px solid ${LINE_FAINT}`,
          borderRadius: 2,
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        colorDefault: {
          backgroundColor: '#173a5f',
          color: INK,
          border: `1px solid ${LINE}`,
          fontFamily: MONO,
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: 'rgba(159, 198, 232, 0.15)', borderRadius: 0 },
      },
    },
  },
});
