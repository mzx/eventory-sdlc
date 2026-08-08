import { Box } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ScannerDialog } from './ScannerDialog';

/**
 * The real component opens the camera via `@zxing/browser` the moment it
 * mounts. Headless/preview environments have no camera, which would flash the
 * error Alert instead of the designed scanning state — so stories feed zxing a
 * fake camera: a canvas-backed MediaStream with a slow scanline animation.
 */
let fakeCameraInstalled = false;
function installFakeCamera() {
  if (fakeCameraInstalled || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
  fakeCameraInstalled = true;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let y = 0;
  window.setInterval(() => {
    if (!ctx) return;
    ctx.fillStyle = '#263238';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, y, canvas.width, 3);
    y = (y + 4) % canvas.height;
  }, 100);

  const getFakeStream = async () => canvas.captureStream(10);
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    writable: true,
    value: getFakeStream,
  });
}

const meta = {
  title: 'Components/ScannerDialog',
  component: ScannerDialog,
  args: {
    open: true,
    onClose: fn(),
  },
  decorators: [
    (Story) => {
      installFakeCamera();
      // Full-height canvas: the Dialog renders into a body portal, so give
      // the story root real height for the modal to center over (also lets
      // static capture tools see the dialog inside the root's box).
      return (
        <Box sx={{ height: '100vh' }}>
          <Story />
        </Box>
      );
    },
  ],
} satisfies Meta<typeof ScannerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open scanner: instruction line and live camera viewport. */
export const Scanning: Story = {};
