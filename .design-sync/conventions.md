# Eventory — build conventions

Eventory is a phone-first workshop/home-inventory app in **black neomorphism**: a near-black canvas with soft-extruded charcoal tiles, depth from dual shadows (dark drop bottom-right + faint light sheen top-left) — never from color. The single accent is luminous workshop green. This bundle ships the app's 5 domain components (`ItemCard`, `LocationTree`, `QrThumb`, `ScannerDialog`, `UserMenu`) **plus the full MUI 6 component surface** (`Box`, `Stack`, `Button`, `AppBar`, `Dialog`, `TextField`, …) on the same global — always use MUI from this bundle for layout and controls, never a second copy.

## Required wrapper

Every screen must sit inside this chain (all three are bundle exports); without it, components render in MUI's default light theme, and `ItemCard`/`LocationTree`/`UserMenu` **throw** (`useNavigate()`/`Link` need a Router):

```jsx
const { ThemeProvider, CssBaseline, MemoryRouter, theme } = window.EventoryWeb;
<ThemeProvider theme={theme}>
  <CssBaseline />
  <MemoryRouter>{/* your screen */}</MemoryRouter>
</ThemeProvider>
```

CssBaseline paints the near-black vignette canvas (`background.default` `#141418`) — never place components on white.

## Styling idiom — no CSS classes, no hand-rolled shadows

This DS is CSS-in-JS: style via MUI's `sx` prop and props, resolving theme tokens by name. **The neumorphic depth is built into the theme** — `Card`/`Paper` render as raised gradient tiles, buttons press in, inputs are sunken wells, menus/dialogs float. Compose with those components instead of writing your own `boxShadow`s. Tokens that define the look (from the `theme` export):

- `primary.main` = `#7ac47f` luminous workshop green — THE accent: the one contained-primary CTA per screen, focus rings, focused fields. Everything else stays grayscale.
- `secondary.main` = `#cf9a62` muted ember (rare); severity colors stay chromatic (error/warning/info/success).
- Surfaces: `background.default` `#141418` canvas, `background.paper` `#1e1e23` tiles; `divider` `rgba(255,255,255,0.08)`.
- Text: `text.primary` `#ececf1`, `text.secondary` `#a9a9b4`; icons in `grey.400`/`grey.500` mid-grays.
- `shape.borderRadius` = 14 (cards are 18, dialogs 20); buttons/menu rows keep `minHeight: 44` — gloved one-handed use, never shrink tap targets.
- Sunken media well (ItemCard's photo placeholder does this): `bgcolor: 'background.default'` + inset shadow, not a light grey box.
- Typography: MUI defaults on the system font stack (no webfont); `subtitle1`/`h5`/`h6` are semibold.

## Data & imagery caveats

- `ItemCard`'s `item.primaryPhoto` and all of `QrThumb` load images from Eventory's API routes (`/storage/…`, `/api/qr/…`) — **they cannot resolve in a design preview**. In mock data always set `primaryPhoto: null` (renders the sunken placeholder tile); treat `QrThumb` as API-bound chrome. Its sticker well is deliberately white — a printed QR needs light ground; don't restyle it dark.
- `ScannerDialog` opens the device camera when `open` — mount it closed and toggle from a button in interactive designs.
- Item mocks follow the `ItemListRow` shape in `ItemCard.d.ts` (`tags: [{ itemId, tagId, tag: { id, name, color } }]`, `location: { id, name, path }` — breadcrumbs render `path` with `.` → ` › `).

## Read before styling

Each component's contract and states: `components/components/<Name>/<Name>.d.ts` + `<Name>.prompt.md`. The theme object itself is `window.EventoryWeb.theme`.

## Idiomatic example — items grid

```jsx
const { ThemeProvider, CssBaseline, MemoryRouter, theme, ItemCard, Box, Typography, Button } = window.EventoryWeb;
const item = {
  id: '1', name: 'M6 hex bolts', description: null, quantity: 250, unit: 'pcs',
  properties: {}, qrCode: 'q1', locationId: 'l1', categoryId: null, primaryPhotoId: null,
  createdAt: '', updatedAt: '', primaryPhoto: null,
  location: { id: 'l1', name: 'Bin 3', path: 'Garage.Shelf A.Bin 3' },
  tags: [{ itemId: '1', tagId: 't1', tag: { id: 't1', name: 'fasteners', color: null } }],
};
<ThemeProvider theme={theme}><CssBaseline /><MemoryRouter>
  <Box sx={{ p: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography variant="h6">Items</Typography>
      <Button variant="contained" color="primary">Add item</Button>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2 }}>
      <ItemCard item={item} />
    </Box>
  </Box>
</MemoryRouter></ThemeProvider>
```
