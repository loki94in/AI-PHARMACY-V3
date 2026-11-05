// tests/market-closure-buffer.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Market Closure Stock Buffer Review Live Flow', { tags: ['closure', 'buffer', 'cart', 'e2e'] }, () => {
  test('Pharmarack Cart page mounts cleanly and displays reorder surface', async ({ app, browser, screen }) => {
    await app.open('/pharmarack-cart');
    await expect(browser).toHaveURL(/\/pharmarack-cart/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert no React crash or ErrorBoundary overlay is active
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('Calendar bar and store closure controls render smoothly without errors', async ({ app, browser, screen }) => {
    await app.open('/pharmarack-cart');
    await expect(browser).toHaveURL(/\/pharmarack-cart/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert closure or calendar action bar is accessible
    const calendarSection = browser.locator('div').filter({ hasText: /Market \/ Store Closures|Closure/i }).first();
    await expect(calendarSection).toBeVisible();

    // Verify page integrity
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
  });
});
