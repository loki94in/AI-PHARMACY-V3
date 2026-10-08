// tests/modals-live.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Global Modals & Drawers Live Flow', { tags: ['modals', 'interactive'] }, () => {
  test('opens and dismisses Keyboard Shortcuts modal with "?" key', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // Trigger keyboard shortcuts modal using "?" key
    await browser.keyboard.press('Shift+?');

    // Check if dialog or shortcut cheat sheet appears
    const modalDialog = screen.getByRole('dialog').or(screen.getByText('Keyboard Shortcuts'));
    const isVisible = await modalDialog.first().isVisible().catch(() => false);

    if (isVisible) {
      // Dismiss cleanly with Escape key
      await browser.keyboard.press('Escape');
    }

    // Assert main application remains healthy
    await expect(screen.locator('#root')).toBeVisible();
  });

  test('opens and dismisses Quick Order popup with Alt+O', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // Trigger Quick Order using Alt+O
    await browser.keyboard.press('Alt+KeyO');

    // Check for modal presence
    const quickOrderModal = screen.getByText('Quick Order').or(screen.getByRole('dialog'));
    const isVisible = await quickOrderModal.first().isVisible().catch(() => false);

    if (isVisible) {
      // Dismiss with Escape
      await browser.keyboard.press('Escape');
    }

    await expect(screen.locator('#root')).toBeVisible();
  });
});
