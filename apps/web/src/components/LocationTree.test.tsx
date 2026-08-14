import { ThemeProvider } from '@mui/material';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LocationNode } from '../lib/locationTree';
import { responsiveDeclaration } from '../test/responsiveStyle';
import { theme } from '../theme';
import { LocationTree } from './LocationTree';

function node(
  id: string,
  name: string,
  itemCount: number,
  children: LocationNode[] = [],
  parentId: string | null = null,
  kind: LocationNode['kind'] = 'area',
): LocationNode {
  return { id, name, path: name, parentId, qrCode: `qr-${id}`, kind, itemCount, children };
}

const nodes: LocationNode[] = [
  node('garage', 'Garage', 42, [node('workbench', 'Workbench', 12, [], 'garage')]),
  node('attic', 'Attic', 7),
];

function renderTree(props: Partial<Parameters<typeof LocationTree>[0]> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <LocationTree
          nodes={nodes}
          onAddChild={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('LocationTree defaultExpanded', () => {
  it('renders collapsed by default — children hidden until the chevron is clicked', async () => {
    renderTree();
    expect(screen.queryByText('Workbench')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Expand Garage'));
    expect(screen.getByText('Workbench')).toBeInTheDocument();
  });

  it('renders children immediately when defaultExpanded is set', () => {
    renderTree({ defaultExpanded: true });
    expect(screen.getByText('Workbench')).toBeInTheDocument();
    // The row still shows the expanded-state toggle.
    expect(screen.getByLabelText('Collapse Garage')).toBeInTheDocument();
  });
});

// EVT-30 AC 5: containers render with a distinct icon from areas.
describe('LocationTree kind icon', () => {
  it('renders the Area icon for an area node and the Container icon for a container node', () => {
    const mixedNodes: LocationNode[] = [
      node('garage', 'Garage', 1, [], null, 'area'),
      node('bin-1', 'Bin 1', 2, [], null, 'container'),
    ];
    renderTree({ nodes: mixedNodes });

    const garageRow = screen.getByTestId('location-node-garage');
    const binRow = screen.getByTestId('location-node-bin-1');

    expect(garageRow.querySelector('[aria-label="Area"]')).not.toBeNull();
    expect(binRow.querySelector('[aria-label="Container"]')).not.toBeNull();
  });

  it('falls back to the Area icon when kind is missing (fixtures predating EVT-30)', () => {
    const legacyNode: LocationNode = { ...node('legacy', 'Legacy', 0), kind: undefined };
    renderTree({ nodes: [legacyNode] });

    expect(
      screen.getByTestId('location-node-legacy').querySelector('[aria-label="Area"]'),
    ).not.toBeNull();
  });
});

// EVT-37 finding #7: rows at depth >= 2 (5 fixed-width controls + unbounded
// `pl: depth * 3` indentation) left <100px for the name at 390px. The cap
// stops the indent growing past depth 3 so the name column stays usable.
describe('LocationTree indent cap (EVT-37 AC 3)', () => {
  // `pl` is a responsive `{ xs, sm }` value (see the `indentPl` doc comment
  // in LocationTree.tsx) — jsdom's `getComputedStyle` does not evaluate the
  // `@media` rules MUI emits for a responsive `sx` value at all, so
  // `toHaveStyle` can't see either breakpoint here; `responsiveDeclaration`
  // reads the actual emitted CSS declaration for each breakpoint directly
  // out of the `<style>` tags emotion inserts.
  it('caps left padding at depth 3 below sm instead of growing indent unbounded per depth', () => {
    const deepChain: LocationNode = node('d0', 'D0', 1, [
      node('d1', 'D1', 1, [
        node('d2', 'D2', 1, [node('d3', 'D3', 1, [node('d4', 'D4', 1)], 'd2')], 'd1'),
      ]),
    ]);
    renderTree({ nodes: [deepChain], defaultExpanded: true });

    expect(responsiveDeclaration(screen.getByTestId('location-node-d0'), 'padding-left', 0)).toBe(
      '0px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d1'), 'padding-left', 0)).toBe(
      '12px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d2'), 'padding-left', 0)).toBe(
      '24px',
    );
    // Depth 3 and depth 4 both cap at the same indent (Math.min(depth, 3)).
    expect(responsiveDeclaration(screen.getByTestId('location-node-d3'), 'padding-left', 0)).toBe(
      '36px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d4'), 'padding-left', 0)).toBe(
      '36px',
    );
  });

  // AC 3: "desktop unchanged" — sm and up keep the original, unbounded
  // `depth * 3` formula (in `theme.spacing` units, 8px each) instead of the
  // xs-only cap above.
  it('keeps the original unbounded depth * 3 indent at sm and up (desktop unchanged)', () => {
    const deepChain: LocationNode = node('d0', 'D0', 1, [
      node('d1', 'D1', 1, [
        node('d2', 'D2', 1, [node('d3', 'D3', 1, [node('d4', 'D4', 1)], 'd2')], 'd1'),
      ]),
    ]);
    renderTree({ nodes: [deepChain], defaultExpanded: true });

    expect(responsiveDeclaration(screen.getByTestId('location-node-d0'), 'padding-left', 600)).toBe(
      '0px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d1'), 'padding-left', 600)).toBe(
      '24px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d2'), 'padding-left', 600)).toBe(
      '48px',
    );
    // Unlike the xs cap, depth 3 and depth 4 keep growing at sm and up.
    expect(responsiveDeclaration(screen.getByTestId('location-node-d3'), 'padding-left', 600)).toBe(
      '72px',
    );
    expect(responsiveDeclaration(screen.getByTestId('location-node-d4'), 'padding-left', 600)).toBe(
      '96px',
    );
  });

  it('truncates a long name with an ellipsis instead of wrapping/pushing controls off-row', () => {
    const longName = 'A'.repeat(80);
    renderTree({ nodes: [node('long', longName, 3)] });

    expect(screen.getByText(longName)).toHaveClass('MuiTypography-noWrap');
  });
});

// EVT-37 finding #7: at xs, rename/add-child/delete move behind one overflow
// `MoreVertIcon` button + menu instead of three separate icon buttons, so
// there's room for a readable name at depth >= 2 on a 390px screen. The
// menu items must fire the identical callbacks as the desktop inline icons.
describe('LocationTree overflow menu (EVT-37 AC 3)', () => {
  // Both the desktop icon Stack and the xs overflow button render as
  // "visible" in jsdom regardless of their `display: { xs, sm }` toggle
  // (jsdom doesn't evaluate `@media` for `getComputedStyle`/`toHaveStyle`
  // at all — see `responsiveDeclaration`'s doc comment), so a regression
  // that deletes or breaks either toggle wouldn't fail any test built only
  // on querying/clicking the elements. This asserts the actual emitted CSS
  // for both breakpoints on both elements, confirming they're exclusive:
  // the desktop Stack is hidden below `sm` and shown at `sm`+, the xs
  // overflow button is the reverse.
  it('desktop icon row and xs overflow button have mutually exclusive display breakpoints', () => {
    renderTree();

    const moreButton = screen.getByRole('button', { name: 'More actions for Garage' });
    // The desktop-only icon-row Stack is the closest `.MuiStack-root`
    // ancestor of one of its icon buttons (Tooltip doesn't add a DOM
    // wrapper, so the button's parent is the Stack itself) — using this
    // instead of a bare row-level `querySelector` avoids matching the
    // outer row Stack that wraps the whole row, including this one.
    const desktopStack = screen
      .getByRole('button', { name: 'Add child to Garage' })
      .closest('.MuiStack-root');
    expect(desktopStack).not.toBeNull();

    expect(responsiveDeclaration(moreButton, 'display', 0)).toBe('inline-flex');
    expect(responsiveDeclaration(moreButton, 'display', 600)).toBe('none');

    expect(responsiveDeclaration(desktopStack as Element, 'display', 0)).toBe('none');
    expect(responsiveDeclaration(desktopStack as Element, 'display', 600)).toBe('flex');
  });

  it('wraps the xs overflow button in a "More actions" Tooltip, matching the desktop icons', async () => {
    renderTree();
    const user = userEvent.setup();

    await user.hover(screen.getByRole('button', { name: 'More actions for Garage' }));

    expect(await screen.findByRole('tooltip', { name: 'More actions' })).toBeInTheDocument();
  });

  it('renames a node via the overflow menu', async () => {
    const onRename = vi.fn();
    renderTree({ onRename });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'Rename Garage' });
    await user.clear(input);
    await user.type(input, 'Workshop{Enter}');

    expect(onRename).toHaveBeenCalledWith('garage', 'Workshop');
  });

  it('adds a child via the overflow menu', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add child' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Shelf C{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Shelf C', 'area');
  });

  it('deletes a leaf node via the overflow menu after confirming', async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTree({ onDelete, nodes: [node('attic', 'Attic', 7)] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Attic' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Attic"? This cannot be undone.');
    expect(onDelete).toHaveBeenCalledWith('attic');
  });

  it('disables the overflow menu Delete item for a node with children', async () => {
    renderTree();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More actions for Garage' }));

    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

// EVT-30 AC 1: containers creatable inline from the tree.
describe('LocationTree add-child kind toggle', () => {
  it('defaults to "area" and creates an area when the toggle is left untouched', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Shelf B{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Shelf B', 'area');
  });

  it('creates a container when the Container toggle is selected before confirming', async () => {
    const onAddChild = vi.fn();
    renderTree({ onAddChild });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add child to Garage' }));
    await user.click(screen.getByRole('button', { name: 'Container' }));
    await user.type(screen.getByLabelText('New child location name for Garage'), 'Tote Box{Enter}');

    expect(onAddChild).toHaveBeenCalledWith('garage', 'Tote Box', 'container');
  });
});
