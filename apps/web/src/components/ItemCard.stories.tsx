import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ItemListRow } from '../api';
import { ItemCard } from './ItemCard';

const baseItem: ItemListRow = {
  id: 'itm-demo-1',
  name: 'Cordless drill',
  description: '18V brushless driver drill',
  quantity: 1,
  unit: null,
  properties: {},
  qrCode: 'demo-item.png',
  locationId: 'loc-workbench',
  categoryId: null,
  primaryPhotoId: 'ph-1',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  tags: [
    {
      itemId: 'itm-demo-1',
      tagId: 'tag-power',
      tag: { id: 'tag-power', name: 'power tools', color: null },
    },
    {
      itemId: 'itm-demo-1',
      tagId: 'tag-18v',
      tag: { id: 'tag-18v', name: '18V', color: null },
    },
  ],
  location: { id: 'loc-workbench', name: 'Workbench', path: 'Garage.Workbench' },
  primaryPhoto: { id: 'ph-1', filename: 'demo-drill.svg', mimeType: 'image/svg+xml' },
};

const meta = {
  title: 'Components/ItemCard',
  component: ItemCard,
  // In the app the card sits in a responsive grid tile; constrain to a
  // typical tile width so the 4:3 photo box renders at grid proportions.
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 280 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof ItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully-populated tile: photo, quantity, location breadcrumb, tag chips. */
export const WithPhoto: Story = {
  args: { item: baseItem },
};

/** No photo uploaded yet — the grey placeholder box with the inventory icon. */
export const PhotoPlaceholder: Story = {
  args: {
    item: {
      ...baseItem,
      id: 'itm-demo-2',
      name: 'M6 hex bolts',
      quantity: 250,
      unit: 'pcs',
      primaryPhotoId: null,
      primaryPhoto: null,
      location: { id: 'loc-bin-3', name: 'Bin 3', path: 'Garage.Shelf A.Bin 3' },
      tags: [
        {
          itemId: 'itm-demo-2',
          tagId: 'tag-fasteners',
          tag: { id: 'tag-fasteners', name: 'fasteners', color: null },
        },
      ],
    },
  },
};

/** Long name truncates with ellipsis; chips wrap onto a second row. */
export const LongNameManyTags: Story = {
  args: {
    item: {
      ...baseItem,
      id: 'itm-demo-3',
      name: 'Random-orbit sander with dust-collection attachment and spare pads',
      quantity: 1,
      primaryPhotoId: null,
      primaryPhoto: null,
      tags: ['power tools', 'sanding', 'woodworking', 'dust collection', '5-inch'].map(
        (name, i) => ({
          itemId: 'itm-demo-3',
          tagId: `tag-${i}`,
          tag: { id: `tag-${i}`, name, color: null },
        }),
      ),
    },
  },
};
