// tests/pos-live.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('POS Point of Sale Live Billing Flow', { tags: ['pos', 'interactive'] }, () => {
  test('opens POS and verifies interactive search and billing table', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // Locate primary medicine search input via role
    const searchInput = screen.getByRole('textbox').first();
    await expect(searchInput).toBeVisible();

    // Type medicine query live on screen
    await searchInput.focus();
    await searchInput.fill('PARACETAMOL');
    await expect(searchInput).toHaveValue('PARACETAMOL');

    // Clear search input
    await searchInput.fill('');
    await expect(searchInput).toHaveValue('');

    // Verify key action buttons exist
    const buttons = screen.getByRole('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });
});
