# Eventory — build conventions

Eventory is a phone-first workshop/home-inventory app: MUI 6 themed "workshop green", big touch targets, high contrast. This bundle ships the app's 5 domain components (`ItemCard`, `LocationTree`, `QrThumb`, `ScannerDialog`, `UserMenu`) **plus the full MUI 6 component surface** (`Box`, `Stack`, `Button`, `AppBar`, `Dialog`, `TextField`, …) on the same global — always use MUI from this bundle for layout and controls, never a second copy.

## Required wrapper

Every screen must sit inside this chain (all three are bundle exports); without it, components render in MUI's default blue instead of Eventory's theme, and `ItemCard`/`LocationTree`/`UserMenu` **throw** (`useNavigate()`/`Link` need a Router):

```jsx
const { ThemeProvider, CssBaseline, MemoryRouter, theme } = window.EventoryWeb;
<ThemeProvider theme={theme}>
  <CssBaseline />
  <MemoryRouter>{/* your screen */}</MemoryRouter>
</ThemeProvider>
```

## Styling idiom — no CSS classes

This DS is CSS-in-JS: style via MUI's `sx` prop and props, resolving theme tokens by name. Do not invent class names; `styles.css` carries no vocabulary. The tokens that define the look (from the `theme` export):

- `primary.main` = `#2e7d32` workshop green (AppBar, buttons); `secondary.main` = `#ef6c00` orange accents
- `shape.borderRadius` = 8; buttons have `minHeight: 44` (gloved/one-handed use — keep tap targets ≥44px)
- Neutral fills: `grey.100` (photo placeholder), `text.secondary` for meta lines, `divider` for borders
- Typography: MUI defaults (`subtitle1` for card titles, `body2`/`caption` for meta) — no webfont; the system stack is correct

## Data & imagery caveats

- `ItemCard`'s `item.primaryPhoto` and all of `QrThumb` load images from Eventory's API routes (`/storage/…`, `/api/qr/…`) — **they cannot resolve in a design preview**. In mock data always set `primaryPhoto: null` (renders the designed placeholder tile); treat `QrThumb` as API-bound chrome.
- `ScannerDialog` opens the device camera when `open` — mount it closed and toggle from a button in interactive designs.
- Item mocks follow the `ItemListRow` shape in `ItemCard.d.ts` (`tags: [{ itemId, tagId, tag: { id, name, color } }]`, `location: { id, name, path }` — breadcrumbs render `path` with `.` → ` › `).

## Read before styling

Each component's contract and states: `components/components/<Name>/<Name>.d.ts` + `<Name>.prompt.md`. The theme object itself is `window.EventoryWeb.theme`.

## Idiomatic example — items grid

```jsx
const { ThemeProvider, CssBaseline, MemoryRouter, theme, ItemCard, Box, Typography } = window.EventoryWeb;
const item = {
  id: '1', name: 'M6 hex bolts', description: null, quantity: 250, unit: 'pcs',
  properties: {}, qrCode: 'q1', locationId: 'l1', categoryId: null, primaryPhotoId: null,
  createdAt: '', updatedAt: '', primaryPhoto: null,
  location: { id: 'l1', name: 'Bin 3', path: 'Garage.Shelf A.Bin 3' },
  tags: [{ itemId: '1', tagId: 't1', tag: { id: 't1', name: 'fasteners', color: null } }],
};
<ThemeProvider theme={theme}><CssBaseline /><MemoryRouter>
  <Box sx={{ p: 2 }}>
    <Typography variant="h6" sx={{ mb: 1 }}>Items</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2 }}>
      <ItemCard item={item} />
    </Box>
  </Box>
</MemoryRouter></ThemeProvider>
```
