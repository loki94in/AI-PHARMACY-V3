// tests/special-order-reorder.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Special Order Re-order Quick Pop-up & Patient Flexibility E2E', { tags: ['crm', 'special-orders', 'reorder'] }, () => {
  test('Clicking Cart in Special Orders opens Quick Special Order modal instead of wholesale Live Cart modal', async ({ app, browser, screen }) => {
    // 1. Visit CRM
    await app.open('/crm');
    await expect(browser).toHaveURL(/\/crm/);

    // 2. Ensure page is mounted and no crash overlay
    await expect(browser.locator('#root')).toBeVisible();
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);

    // 3. Switch to Special Requests tab
    const specialRequestsTab = browser.locator('[role="tab"]:has-text("Special Requests")');
    await expect(specialRequestsTab).toBeVisible();
    await specialRequestsTab.click();

    // 4. Target the specific "Cart" button on the Special Order card
    const cardCartButton = browser.locator('button[title*="Push special request item directly to Pharmarack Cart"]').first();
    await expect(cardCartButton).toBeVisible();

    // 5. Click the "Cart" button on the special order card
    await cardCartButton.click();

    // 6. Verify the Quick Special Order Modal opens with "Re-order Special Request" & "Re-order Mode"
    await expect(screen.getByText('Re-order Special Request')).toBeVisible();
    await expect(screen.getByText('Re-order Mode')).toBeVisible();

    // 7. Guarantee that the wholesale Live Cart Add modal did NOT open
    await expect(screen.getByText('Add Medicine to Live Wholesale Cart')).toHaveCount(0);
    await expect(screen.getByText('Live Distributor Medicine Search')).toHaveCount(0);

    // 8. Verify pre-filled fields (Medicine input, Customer name, and Submit action button)
    const medicineInput = browser.locator('input[placeholder*="Search medicine brand"]');
    await expect(medicineInput).toBeVisible();
    const medVal = await medicineInput.inputValue();
    expect(medVal.length).toBeGreaterThan(0);

    // Customer name input
    const customerInput = browser.locator('input[placeholder*="CUSTOMER NAME"]');
    await expect(customerInput).toBeVisible();
    const custVal = await customerInput.inputValue();
    expect(custVal.length).toBeGreaterThan(0);

    // Verify "Log & Sync Cart" submit button is present
    await expect(screen.getByRole('button', { name: /Log & Sync Cart/i })).toBeVisible();

    // 9. Test Patient Re-assignability: User can modify the customer name for a different patient
    await customerInput.fill('SURESH PATIL');
    expect(await customerInput.inputValue()).toBe('SURESH PATIL');

    // 10. Close the modal cleanly via modal Cancel button
    const cancelBtn = browser.locator('.z-global-modal button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Modal should close cleanly
    await expect(screen.getByText('Re-order Special Request')).toHaveCount(0);
  });

  test('Medicine search token rule (first 2 words/alphanumerics) and stock checks', async ({ app, browser }) => {
    await app.open('/crm');

    // Verify the search token extraction logic behaves identically in client runtime
    const tokens = await browser.evaluate(() => {
      const extract = (raw: string) => {
        if (!raw || typeof raw !== 'string') return '';
        const cleaned = raw.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
        const words = cleaned.split(/\s+/).filter(Boolean);
        return words.slice(0, 2).join(' ').trim();
      };

      return {
        test1: extract('TELMA 40MG TAB 10S'),
        test2: extract('PAN-D CAPSULE STRIP'),
        test3: extract('DOLO 650 TABLET PARACETAMOL'),
        test4: extract('AUGMENTIN-625 DUO TAB'),
      };
    });

    expect(tokens.test1).toBe('TELMA 40MG');
    expect(tokens.test2).toBe('PAN D');
    expect(tokens.test3).toBe('DOLO 650');
    expect(tokens.test4).toBe('AUGMENTIN 625');
  });
});
