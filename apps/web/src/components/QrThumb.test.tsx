import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrThumb } from './QrThumb';

function openFakePrintWindow() {
  const printSpy = vi.fn();
  const popupDocument = document.implementation.createHTMLDocument('');
  const fakeWindow = {
    document: popupDocument,
    print: printSpy,
    opener: window,
    onload: null as (() => void) | null,
  };
  vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
  return { popupDocument, printSpy, fakeWindow };
}

describe('QrThumb', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a malicious label as text in the print popup, not markup, and drops the opener', async () => {
    const maliciousLabel = '<img src=x onerror=alert(1)>';
    const { popupDocument, fakeWindow } = openFakePrintWindow();

    render(<QrThumb token="qr-item-1" label={maliciousLabel} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print sticker' }));

    // The popup's title and body text carry the raw label as text content —
    // never parsed as HTML.
    expect(popupDocument.title).toBe(maliciousLabel);
    expect(popupDocument.body.textContent).toContain(maliciousLabel);

    // No injected <img onerror> — only the single legitimate QR <img>.
    const images = popupDocument.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('onerror')).toBeNull();
    expect(images[0].alt).toBe('QR code');

    // The opener reference is severed so the popup can't reach back in.
    expect(fakeWindow.opener).toBeNull();
  });

  it('prints via the popup window once it loads', async () => {
    const { fakeWindow, printSpy } = openFakePrintWindow();

    render(<QrThumb token="qr-item-1" label="Garage" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print sticker' }));

    expect(printSpy).not.toHaveBeenCalled();
    fakeWindow.onload?.();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing if the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(<QrThumb token="qr-item-1" label="Garage" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print sticker' }));

    // No throw — handlePrint returns early when window.open is blocked.
    expect(window.open).toHaveBeenCalled();
  });
});
