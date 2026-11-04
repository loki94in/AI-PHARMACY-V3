// tests/deleted-columns-safety.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Deleted Columns & Triggers User Safety Live Flow', { tags: ['safety', 'e2e'] }, () => {
  test('Website Orders page renders live special orders without product column failure', async ({ app, browser, screen }) => {
    await app.open('/website-orders');
    await expect(browser).toHaveURL(/\/website-orders/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert no runtime React crash overlay
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('Dispatch page renders distributors and reminders without contact column failure', async ({ app, browser, screen }) => {
    await app.open('/dispatch');
    await expect(browser).toHaveURL(/\/dispatch/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert no crash overlay
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('CRM & WhatsApp page renders patient directory and history without preferred_language failure', async ({ app, browser, screen }) => {
    await app.open('/crm');
    await expect(browser).toHaveURL(/\/crm/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert no crash overlay
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });

  test('Customer Web Portal renders prescription orders and refills smoothly', async ({ app, browser, screen }) => {
    await app.open('/portal');
    await expect(browser).toHaveURL(/\/portal/);
    await expect(browser.locator('#root')).toBeVisible();

    // Assert no crash overlay
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);
  });
});
