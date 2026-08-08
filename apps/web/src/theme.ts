import { createTheme } from '@mui/material';
import type { Shadows } from '@mui/material/styles';

/**
 * Black-neomorphism theme — near-black canvas, soft-extruded charcoal
 * surfaces. Depth comes from a dual shadow (dark drop bottom-right + faint
 * light sheen top-left), ~145deg surface gradients, and hairline light
 * borders — never from color. The single accent is Eventory's workshop
 * green, re-lit luminous for dark surfaces; everything else is grayscale so
 * the one color always reads as "the action".
 *
 * Phone-first constraints kept from the original theme: this app is used
 * standing in a garage, often one-handed/gloved — tap targets stay >= 44px
 * and body text holds >= 4.5:1 against its surface (workshop lighting,
 * glare).
 */

// --- Gray ramp anchors ------------------------------------------------------
const CANVAS = '#141418'; // page background
const SURFACE = '#1e1e23'; // paper base
const SUNKEN = '#17171b'; // inset wells (inputs, media wells)
const HAIRLINE = 'rgba(255, 255, 255, 0.07)';

// --- Accent: workshop green, re-lit for dark --------------------------------
// ~7.9:1 as text on SURFACE; near-black ink on green fills is ~8.9:1.
const ACCENT = '#7ac47f';
const ACCENT_INK = '#0e1810';

// --- Neumorphic recipe ------------------------------------------------------
const SURFACE_GRADIENT = 'linear-gradient(145deg, #232329 0%, #1a1a1f 100%)';
const SURFACE_GRADIENT_HIGH = 'linear-gradient(145deg, #26262c 0%, #1b1b21 100%)';

/** Raised tile: dark drop shadow bottom-right + faint light sheen top-left. */
const RAISED = '6px 6px 14px rgba(0, 0, 0, 0.45), -4px -4px 10px rgba(255, 255, 255, 0.045)';
const RAISED_SM = '3px 3px 8px rgba(0, 0, 0, 0.4), -2px -2px 6px rgba(255, 255, 255, 0.04)';
/** Pressed control: inset dual shadow. */
const PRESSED =
  'inset 4px 4px 9px rgba(0, 0, 0, 0.55), inset -3px -3px 7px rgba(255, 255, 255, 0.035)';
/** Sunken field well (inputs) — shallower inset. */
const WELL = 'inset 3px 3px 7px rgba(0, 0, 0, 0.5), inset -2px -2px 5px rgba(255, 255, 255, 0.03)';
/** Keyboard-focus ring + soft green bloom — visible on any charcoal surface. */
const FOCUS_RING = '0 0 0 2px rgba(122, 196, 127, 0.55), 0 0 12px 2px rgba(122, 196, 127, 0.22)';

/** Regenerated elevation ramp: every MUI elevation keeps the dual-source language. */
const neuShadows = [
  'none',
  ...Array.from({ length: 24 }, (_, i) => {
    const drop = Math.min(i + 2, 16);
    const blur = drop * 2 + 6;
    const sheen = Math.max(2, Math.round(drop * 0.6));
    return (
      `${drop}px ${drop}px ${blur}px rgba(0, 0, 0, 0.45), ` +
      `-${sheen}px -${sheen}px ${Math.round(blur * 0.75)}px rgba(255, 255, 255, 0.04)`
    );
  }),
] as unknown as Shadows;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    // Workshop green survives the redesign, desaturated + luminous for dark.
    primary: { main: ACCENT, light: '#9ad39e', dark: '#5aa763', contrastText: ACCENT_INK },
    // Kept (not dropped) so `color="secondary"` API keeps working, but muted
    // to ember so the field stays essentially monochrome.
    secondary: { main: '#cf9a62', light: '#e0b285', dark: '#b07f4c', contrastText: '#1c1207' },
    // Severity stays chromatic on purpose — safety signal, not brand accent.
    error: { main: '#e57373' },
    warning: { main: '#ffb74d' },
    info: { main: '#7dbcd8' },
    success: { main: '#81c784' },
    background: { default: CANVAS, paper: SURFACE },
    divider: 'rgba(255, 255, 255, 0.08)',
    text: {
      primary: '#ececf1', // ~14:1 on SURFACE
      secondary: '#a9a9b4', // ~7:1 on SURFACE — survives the gradient's light stop
      disabled: 'rgba(236, 236, 241, 0.45)',
    },
    // Ramp re-centered for the dark UI so existing component tokens resolve
    // correctly with zero edits: grey.900 stays near-black (ScannerDialog
    // video well), grey.400/500 are legible mid-gray icon tones (ItemCard,
    // ItemsPage, ProjectsPage, PendingPage placeholder icons).
    grey: {
      50: '#f4f4f6',
      100: '#e8e8ec',
      200: '#d4d4da',
      300: '#b7b7c0',
      400: '#8f8f9a', // ~5:1 on the canvas — decorative 48px icons stay visible
      500: '#84848f',
      600: '#54545e',
      700: '#3a3a42',
      800: '#26262b',
      900: '#17171b',
      A100: '#e8e8ec',
      A200: '#d4d4da',
      A400: '#8f8f9a',
      A700: '#3a3a42',
    },
    action: {
      active: '#c9c9d2',
      hover: 'rgba(255, 255, 255, 0.06)',
      selected: 'rgba(255, 255, 255, 0.09)',
      disabled: 'rgba(236, 236, 241, 0.32)',
      disabledBackground: 'rgba(255, 255, 255, 0.06)',
      focus: 'rgba(122, 196, 127, 0.24)',
    },
  },
  // Generous rounding is part of the neumorphic language (was 8).
  shape: { borderRadius: 14 },
  shadows: neuShadows,
  typography: {
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0.2 },
    subtitle1: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: 'dark' },
        body: {
          backgroundColor: CANVAS,
          // Barely-there vignette so the canvas isn't a flat void.
          backgroundImage: 'radial-gradient(1100px 700px at 15% -10%, #1b1b20 0%, #141418 60%)',
          backgroundAttachment: 'fixed',
        },
        // Printers drop dark backgrounds, which would leave near-white UI
        // text invisible on paper — force ink-on-white for print output so
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
        // Kill MUI's dark-mode elevation overlay, then paint our own
        // top-left-lit surface gradient per variant below.
        root: {
          backgroundImage: 'none',
          border: `1px solid ${HAIRLINE}`,
        },
        elevation: { backgroundImage: SURFACE_GRADIENT },
        // `variant="outlined"` Paper (ItemCard's Card, LoginPage) reads as a
        // raised tile, not a flat outline — outlined papers have no elevation
        // shadow unless we add one here.
        outlined: { backgroundImage: SURFACE_GRADIENT, boxShadow: RAISED },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          overflow: 'hidden', // square media (ItemCard photo well) follows the big radius
          backgroundImage: SURFACE_GRADIENT,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: RAISED,
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          // Inset ring survives the card's overflow:hidden clipping.
          '&.Mui-focusVisible': { boxShadow: 'inset 0 0 0 2px rgba(122, 196, 127, 0.6)' },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44, // gloved-thumb tap target, all sizes incl. size="small"
          borderRadius: 12,
          transition: 'box-shadow 120ms ease, background-color 120ms ease, transform 120ms ease',
          '&.Mui-focusVisible': { boxShadow: FOCUS_RING },
        },
        // Neutral contained buttons are raised charcoal tiles that press in.
        contained: {
          backgroundColor: '#202025',
          backgroundImage: SURFACE_GRADIENT_HIGH,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: RAISED_SM,
          '&:hover': { boxShadow: RAISED, backgroundColor: '#232329' },
          '&:active': { boxShadow: PRESSED, transform: 'translateY(1px)' },
          '&.Mui-focusVisible': { boxShadow: `${FOCUS_RING}, ${RAISED_SM}` },
          '&.Mui-disabled': { backgroundImage: 'none', boxShadow: 'none' },
        },
        // The one loud element: luminous workshop-green CTA with a soft bloom
        // — the inspiration's glowing accent, in brand color.
        containedPrimary: {
          color: ACCENT_INK,
          backgroundColor: ACCENT,
          backgroundImage: 'linear-gradient(145deg, #8ccf92 0%, #67b16e 100%)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow:
            '5px 5px 12px rgba(0, 0, 0, 0.5), -3px -3px 8px rgba(255, 255, 255, 0.05), 0 0 14px rgba(122, 196, 127, 0.22)',
          '&:hover': {
            backgroundColor: '#86cb8c',
            backgroundImage: 'linear-gradient(145deg, #97d69c 0%, #6fb976 100%)',
          },
          '&:active': {
            backgroundImage: 'linear-gradient(145deg, #67b16e 0%, #8ccf92 100%)',
            boxShadow:
              'inset 4px 4px 8px rgba(0, 0, 0, 0.35), inset -2px -2px 6px rgba(255, 255, 255, 0.15)',
          },
        },
        containedSecondary: {
          color: '#1c1207',
          backgroundImage: 'linear-gradient(145deg, #daa771 0%, #bf8a52 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: RAISED_SM,
          '&:active': { boxShadow: 'inset 3px 3px 7px rgba(0, 0, 0, 0.3)' },
        },
        outlined: {
          borderColor: 'rgba(255, 255, 255, 0.16)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          backgroundImage: SURFACE_GRADIENT,
          boxShadow: RAISED_SM,
          '&:hover': {
            borderColor: 'rgba(255, 255, 255, 0.28)',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
          },
          '&:active': { boxShadow: PRESSED },
        },
        // Deliberately flat (AppBar nav, dialog actions) — raising every text
        // button would be noise; hover/pressed still unmistakable.
        text: {
          '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.07)' },
          '&:active': { backgroundColor: 'rgba(0, 0, 0, 0.28)', boxShadow: PRESSED },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: '#a9a9b4',
          transition: 'box-shadow 120ms ease, background-color 120ms ease',
          '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.07)' },
          '&:active': { boxShadow: PRESSED },
          '&.Mui-focusVisible': { boxShadow: FOCUS_RING },
          '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.26)' },
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
        root: { fontWeight: 500 },
        // Raised badge chips — the inspiration's tiny "+33%" pills.
        filled: {
          backgroundColor: '#26262b',
          backgroundImage: 'linear-gradient(145deg, #2b2b31 0%, #202025 100%)',
          border: `1px solid ${HAIRLINE}`,
          color: '#d6d6de',
          boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.35), -1px -1px 3px rgba(255, 255, 255, 0.04)',
        },
        // Chips-of-interest: quiet green glow instead of a solid fill.
        colorPrimary: {
          backgroundColor: 'rgba(122, 196, 127, 0.16)',
          backgroundImage: 'none',
          border: '1px solid rgba(122, 196, 127, 0.35)',
          color: '#9ad39e',
        },
        // Count badges (LocationTree) read as quietly sunken, not raised.
        outlined: {
          borderColor: 'rgba(255, 255, 255, 0.14)',
          backgroundColor: SUNKEN,
          boxShadow: 'inset 2px 2px 4px rgba(0, 0, 0, 0.35)',
          color: '#c9c9d2',
        },
        deleteIcon: {
          color: 'rgba(255, 255, 255, 0.4)',
          '&:hover': { color: 'rgba(255, 255, 255, 0.7)' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        // Fields read as sunken/engraved wells — the inverse of raised tiles.
        root: {
          backgroundColor: SUNKEN,
          borderRadius: 12,
          boxShadow: WELL,
          '&.MuiInputBase-sizeSmall': { minHeight: 44 }, // LocationTree inline editors
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.08)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.16)' },
          '&.Mui-focused': { boxShadow: `${WELL}, 0 0 0 3px rgba(122, 196, 127, 0.18)` },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(122, 196, 127, 0.6)',
            borderWidth: 1,
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#e57373' },
        },
        input: {
          '&::placeholder': { color: '#8f8f9a', opacity: 1 }, // ~5:1 on SUNKEN
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#a9a9b4',
          '&.Mui-focused': { color: '#9ad39e' },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 20,
          backgroundImage: SURFACE_GRADIENT_HIGH,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '14px 14px 36px rgba(0, 0, 0, 0.6), -6px -6px 18px rgba(255, 255, 255, 0.04)',
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { backgroundColor: 'rgba(10, 10, 13, 0.72)' },
        invisible: { backgroundColor: 'transparent' },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          border: 'none',
          borderBottom: '1px solid rgba(122, 196, 127, 0.22)', // brand hairline
          borderRadius: 0,
          backgroundImage: 'linear-gradient(180deg, #1e1e24 0%, #17171c 100%)',
          // Sticky bar needs separation from scrolling dark content — soft
          // drop + bottom sheen (replaces the old boxShadow: 'none').
          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35), inset 0 -1px 0 rgba(255, 255, 255, 0.05)',
        },
        // App.tsx mounts <AppBar color="primary" enableColorOnDark>; force the
        // charcoal surface at theme level instead of editing the component.
        colorPrimary: { backgroundColor: '#17171c', color: '#ececf1' },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          backgroundImage: SURFACE_GRADIENT_HIGH,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: '8px 8px 22px rgba(0, 0, 0, 0.55), -4px -4px 12px rgba(255, 255, 255, 0.035)',
          marginTop: 6,
        },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 44, // thumb-sized menu rows (UserMenu)
          borderRadius: 10,
          margin: '2px 4px',
          '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
          '&.Mui-focusVisible': { backgroundColor: 'rgba(122, 196, 127, 0.12)' },
          '&.Mui-selected': { backgroundColor: 'rgba(255, 255, 255, 0.09)' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 10,
          '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
          '&.Mui-focusVisible': { boxShadow: `inset ${FOCUS_RING}` },
          '&.Mui-selected': { backgroundImage: SURFACE_GRADIENT, boxShadow: RAISED_SM },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#2a2a30',
          color: '#ececf1',
          border: `1px solid ${HAIRLINE}`,
          boxShadow: '4px 4px 10px rgba(0, 0, 0, 0.5)',
          fontSize: '0.75rem',
        },
        arrow: { color: '#2a2a30' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          // Alert extends Paper and carries the MuiPaper-elevation class —
          // drop the inherited opaque surface gradient so severity tints
          // (ScannerDialog errors, page-level alerts) stay visible.
          backgroundImage: 'none',
          boxShadow: 'none',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 12,
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        colorDefault: {
          backgroundColor: '#2e2e35',
          color: '#ececf1',
          border: `1px solid ${HAIRLINE}`,
        },
      },
    },
  },
});
