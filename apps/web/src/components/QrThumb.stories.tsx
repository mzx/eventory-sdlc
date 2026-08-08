import type { Meta, StoryObj } from '@storybook/react-vite';
import { QrThumb } from './QrThumb';

// The token doubles as the fixture filename: `qrImageUrl` builds
// `/api/qr/demo-item.png?size=…`, which the Storybook static dir serves
// (see .storybook/public/api/qr/).
const meta = {
  title: 'Components/QrThumb',
  component: QrThumb,
  args: {
    token: 'demo-item.png',
    label: 'Garage › Shelf A › Bin 1',
  },
} satisfies Meta<typeof QrThumb>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default 160px sticker thumbnail with caption and print action. */
export const Default: Story = {};

/** Compact 96px variant, as used in dense detail layouts. */
export const Small: Story = {
  args: { size: 96, label: 'Bin 1' },
};

/** No caption — image and print action only. */
export const NoLabel: Story = {
  args: { label: undefined },
};
