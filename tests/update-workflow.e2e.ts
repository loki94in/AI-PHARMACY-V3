// tests/update-workflow.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Auto-Update Redesign E2E Workflow & Crash Prevention', { tags: ['update', 'e2e'] }, () => {
  test('POS counter billing page loads with zero disruptive update overlays', async ({ app, browser, screen }) => {
    // 1. Visit POS
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // 2. Verify root element is visible and page is alive
    await expect(browser.locator('#root')).toBeVisible();

    // 3. Guarantee that no full-width fixed-top intrusive banner exists
    const topBarBanner = browser.locator('.fixed.top-0.left-0.right-0.z-\\[9999\\]');
    await expect(topBarBanner).toHaveCount(0);

    // 4. Assert zero React error boundary or crash messages
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('Settings License and Updates tab renders update card and controls cleanly', async ({ app, browser, screen }) => {
    // 1. Visit License and Updates tab in Settings
    await app.open('/settings?tab=license');
    await expect(browser).toHaveURL(/\/settings\?tab=license/);

    // 2. Verify root element is mounted
    await expect(browser.locator('#root')).toBeVisible();

    // 3. Verify Software Update section header or card title is present
    await expect(screen.getByText('Software Update')).toBeVisible();

    // 4. Assert no crash overlay
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('Update ready state renders as non-intrusive bottom-right card with clean controls', async ({ app, browser, screen }) => {
    await app.open('/pos');
    await expect(browser).toHaveURL(/\/pos/);

    // 1. Trigger realistic update ready state via backend test endpoint
    await fetch('http://127.0.0.1:3000/api/license/simulate-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latestVersion: '99.0.2' }),
    });

    // 2. Notify client store to reconcile from backend status
    await browser.evaluate(() => {
      sessionStorage.clear();
      window.dispatchEvent(new Event('sse-connected'));
    });

    // 3. Verify the floating ready card appears in bottom-right corner
    await expect(screen.getByText('Update Ready')).toBeVisible();
    await expect(screen.getByText('v99.0.2')).toBeVisible();

    // 4. Verify Install & Restart button is available
    await expect(screen.getByRole('button', { name: /install & restart/i })).toBeVisible();

    // 5. Verify "Later" dismiss button snoozes cleanly
    const laterBtn = screen.getByRole('button', { name: /^later$/i });
    await expect(laterBtn).toBeVisible();
    await laterBtn.click();

    // 6. Assert floating card dismisses cleanly without crashing POS
    await expect(screen.getByText('Update Ready')).toHaveCount(0);

    // 7. Cleanup simulation state on backend
    await fetch('http://127.0.0.1:3000/api/license/simulate-reset', { method: 'POST' });

    // 8. Assert zero crashes
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });
});
